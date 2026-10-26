"""Cuerpo de Pío: cámara, pantalla, servos, ruedas y sensores.

Cada pieza tiene versión real (Raspberry Pi 5) y simulada (portátil con webcam), con la
misma interfaz. Las librerías de hardware se importan solo al usarlas.

Pi 5: `RPi.GPIO` no funciona; instala `rpi-lgpio` (sustituto compatible) para luma.lcd.
"""
from __future__ import annotations

import logging
import math
import threading
import time

import numpy as np
from PIL import Image

log = logging.getLogger(__name__)


def _finite(v: float, default: float = 0.0) -> float:
    """Un NaN/inf nunca llega a un actuador: min/max de Python lo convertirían en un tope."""
    return v if isinstance(v, (int, float)) and math.isfinite(v) else default


# ---------------------------------------------------------------- cámara
class Camera:
    def __init__(self, cfg: dict, sim: bool):
        self.w, self.h = cfg["width"], cfg["height"]
        self._picam = self._cap = None
        if not sim:
            from picamera2 import Picamera2  # noqa: PLC0415

            self._picam = Picamera2()
            # "RGB888" en picamera2 entrega los bytes en orden BGR: justo lo que quiere OpenCV
            self._picam.configure(self._picam.create_video_configuration({"size": (self.w, self.h), "format": "RGB888"}))
            self._picam.start()
        else:
            try:
                import cv2  # noqa: PLC0415

                self._cap = cv2.VideoCapture(cfg.get("index", 0))
                if not self._cap.isOpened():
                    self._cap = None
            except ImportError:
                pass
            if self._cap is None:
                log.warning("sin webcam: el simulador verá una imagen gris")

    def read(self) -> np.ndarray:
        if self._picam is not None:
            return self._picam.capture_array()
        if self._cap is not None:
            ok, frame = self._cap.read()
            if ok:
                return frame
        return np.full((self.h, self.w, 3), 90, np.uint8)


# ---------------------------------------------------------------- pantalla
class Display:
    def __init__(self, cfg: dict, sim: bool):
        self.sim, self._dev = sim, None
        if not sim:
            from luma.core.interface.serial import spi  # noqa: PLC0415
            from luma.lcd import device  # noqa: PLC0415

            serial = spi(port=cfg["spi_port"], device=cfg["spi_device"], gpio_DC=cfg["gpio_dc"],
                         gpio_RST=cfg["gpio_rst"], bus_speed_hz=cfg["spi_hz"])
            self._dev = getattr(device, cfg["driver"])(serial, width=cfg["width"], height=cfg["height"], rotate=cfg["rotate"])

    def show(self, img: Image.Image) -> None:
        if self._dev is not None:
            self._dev.display(img)


# ---------------------------------------------------------------- cuello y antenas
class Servos:
    """Servos en un PCA9685 (I2C). Limita ángulo y velocidad: movimientos suaves = más vivo."""

    def __init__(self, cfg: dict, sim: bool):
        self.ch, self.limits, self.trim = cfg["channels"], cfg["limits"], cfg["trim"]
        self.max_speed = cfg["max_deg_per_s"]
        self.pos = {k: 0.0 for k in self.ch}
        self._kit = None
        if not sim:
            from adafruit_servokit import ServoKit  # noqa: PLC0415

            self._kit = ServoKit(channels=16)

    def update(self, targets: dict[str, float], dt: float) -> dict[str, float]:
        step = self.max_speed * dt
        for name, target in targets.items():
            if name not in self.ch:
                continue
            lo, hi = self.limits[name]
            target = min(hi, max(lo, _finite(target, self.pos[name])))
            cur = self.pos[name]
            self.pos[name] = cur + max(-step, min(step, target - cur))
            if self._kit is not None:
                self._kit.servo[self.ch[name]].angle = min(180, max(0, 90 + self.pos[name] + self.trim[name]))
        return self.pos


# ---------------------------------------------------------------- ruedas
class Wheels:
    """Dos motores N20 en un DRV8833 (dos pines PWM por motor).

    Lleva un "hombre muerto": si nadie llama a `drive()` en `watchdog_s` segundos (el bucle se
    ha colgado, la cámara se ha bloqueado...), un hilo aparte para los motores.
    """

    def __init__(self, cfg: dict, sim: bool):
        self.max = cfg["max_speed"]
        self.watchdog_s = cfg.get("watchdog_s", 0.5)
        self.speed = (0.0, 0.0)
        self._l = self._r = None
        self._lock = threading.Lock()
        self._last_cmd = time.monotonic()
        self._closed = threading.Event()
        if not sim:
            from gpiozero import Motor  # noqa: PLC0415

            self._l, self._r = Motor(*cfg["left"]), Motor(*cfg["right"])
        threading.Thread(target=self._watchdog, name="wheels-watchdog", daemon=True).start()

    def drive(self, left: float, right: float) -> None:
        left, right = (max(-1.0, min(1.0, _finite(v))) * self.max for v in (left, right))
        with self._lock:
            self._last_cmd = time.monotonic()
            self._set(left, right)

    def _set(self, left: float, right: float) -> None:
        self.speed = (left, right)
        for m, v in ((self._l, left), (self._r, right)):
            if m is None:
                continue
            if abs(v) < 0.05:
                m.stop()
            elif v > 0:
                m.forward(v)
            else:
                m.backward(-v)

    def _watchdog(self) -> None:
        while not self._closed.wait(self.watchdog_s / 4):
            with self._lock:
                if self.speed != (0.0, 0.0) and time.monotonic() - self._last_cmd > self.watchdog_s:
                    log.error("el bucle no manda órdenes desde hace %.1fs: paro las ruedas", self.watchdog_s)
                    self._set(0.0, 0.0)

    def stop(self) -> None:
        self.drive(0, 0)

    def close(self) -> None:
        self.stop()
        self._closed.set()
        for m in (self._l, self._r):
            if m is not None:
                m.close()


# ---------------------------------------------------------------- sensores
class Sensors:
    """2 sensores IR de borde (TCRT5000, salida digital) + ToF frontal VL53L0X opcional."""

    def __init__(self, cfg: dict, sim: bool):
        self.obstacle_mm = cfg["obstacle_mm"]
        self.sim_cliff_l = self.sim_cliff_r = self.sim_obstacle = False
        self._cl = self._cr = self._tof = None
        if not sim:
            from gpiozero import DigitalInputDevice  # noqa: PLC0415

            # TCRT5000: el módulo pone la salida en ALTO cuando NO ve suelo (no rebota el IR).
            # Con pull-up, un sensor desconectado también lee ALTO = "sin suelo": Pío no se
            # mueve en vez de lanzarse a ciegas por el borde de la mesa (falla hacia lo seguro).
            self._cl = DigitalInputDevice(cfg["cliff_left"], pull_up=True)
            self._cr = DigitalInputDevice(cfg["cliff_right"], pull_up=True)
            if cfg["tof"]:
                try:
                    import adafruit_vl53l0x  # noqa: PLC0415
                    import board  # noqa: PLC0415

                    self._tof = adafruit_vl53l0x.VL53L0X(board.I2C())
                except Exception as e:
                    log.warning("ToF no disponible: %s", e)

    def read(self) -> tuple[bool, bool, bool]:
        if self._cl is None:
            return self.sim_cliff_l, self.sim_cliff_r, self.sim_obstacle
        obstacle = False
        if self._tof is not None:
            try:
                obstacle = self._tof.range < self.obstacle_mm
            except OSError:
                pass
        # con pull_up=True gpiozero considera "activo" el nivel BAJO (= ve suelo)
        return not self._cl.is_active, not self._cr.is_active, obstacle


# ---------------------------------------------------------------- HUD del simulador
def sim_hud(face_img: Image.Image, frame: np.ndarray, pos: dict, wheels: tuple, state: str, energy: float) -> np.ndarray:
    """Compone cara + cámara + estado en una imagen BGR para cv2.imshow."""
    import cv2  # noqa: PLC0415

    face = cv2.cvtColor(np.asarray(face_img), cv2.COLOR_RGB2BGR)
    # inclina la cara según el roll del cuello: así se ve el gesto "¿eh?" en el simulador
    m = cv2.getRotationMatrix2D((face.shape[1] / 2, face.shape[0] / 2), pos.get("roll", 0), 1.0)
    face = cv2.warpAffine(face, m, (face.shape[1], face.shape[0]), borderValue=(40, 40, 40))
    cam = cv2.resize(frame, (int(frame.shape[1] * face.shape[0] / frame.shape[0]), face.shape[0]))
    hud = np.hstack([face, cam])
    txt = f"{state}  energia={energy:.2f}  pan={pos.get('pan', 0):+.0f} tilt={pos.get('tilt', 0):+.0f} " \
          f"ruedas=({wheels[0]:+.2f},{wheels[1]:+.2f})"
    cv2.putText(hud, txt, (8, hud.shape[0] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
    cv2.putText(hud, "[l] cogerlo  [c] borde  [o] obstaculo  [q] salir", (8, 18),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 200, 200), 1, cv2.LINE_AA)
    return hud
