"""Arranca a Pío.

    python -m pio --sim                 # en tu portátil, con webcam
    python -m pio -c config.yaml        # en la Raspberry Pi 5
"""
from __future__ import annotations

import argparse
import logging
import signal
import time

from . import config as config_mod
from .brain import Brain, Percepts
from .face import Face
from .hardware import Camera, Display, Sensors, Servos, Wheels, sim_hud
from .sounds import Voice
from .vision import FaceDetector
from .vlm import VLMWorker

log = logging.getLogger("pio")


def main() -> None:
    ap = argparse.ArgumentParser(prog="pio", description="Pío, el micro droide pato")
    ap.add_argument("-c", "--config", help="ruta a config.yaml")
    ap.add_argument("--sim", action="store_true", help="modo simulador (sin hardware)")
    ap.add_argument("--no-vlm", action="store_true", help="solo reflejos, sin VLM")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    cfg = config_mod.load(args.config)
    sim = args.sim
    cam_cfg, disp = cfg["camera"], cfg["display"]

    camera = Camera(cam_cfg, sim)
    display = Display(disp, sim)
    servos = Servos(cfg["servos"], sim)
    wheels = Wheels(cfg["motors"], sim)
    sensors = Sensors(cfg["sensors"], sim)
    voice = Voice(**cfg["audio"])
    detector = FaceDetector()
    face = Face(disp["width"], disp["height"])
    brain = Brain(hfov=cam_cfg["hfov_deg"], vfov=cam_cfg["vfov_deg"], vlm_every_s=cfg["vlm"]["every_s"])
    v = cfg["vlm"]
    vlm = None if args.no_vlm else VLMWorker(v["url"], v["prompt"], v["max_tokens"], v["timeout_s"], v["jpeg_width"], cfg["diary"])

    running = True

    def _stop(*_):
        nonlocal running
        running = False

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    period = 1.0 / cfg["loop_hz"]
    last = time.monotonic()
    voice.say("hello")
    log.info("Pío despierto (%s)", "simulador" if sim else "Raspberry Pi")
    try:
        while running:
            now = time.monotonic()
            dt, last = now - last, now

            frame = camera.read()
            cliff_l, cliff_r, obstacle = sensors.read()
            percepts = Percepts(t=now, face=detector.detect(frame), cliff_left=cliff_l, cliff_right=cliff_r,
                                obstacle=obstacle, observation=vlm.poll() if vlm else None)

            act = brain.step(percepts)

            if act.want_vlm and vlm and brain.state != "SLEEP" and vlm.request(frame):
                brain.vlm_sent(now)
            pos = servos.update({"pan": act.pan, "tilt": act.tilt, "roll": act.roll,
                                 "antenna_l": act.antenna_l, "antenna_r": act.antenna_r}, dt)
            wheels.drive(act.left, act.right)
            if act.say:
                voice.say(act.say)

            face.state.mood, face.state.blush = act.mood, act.blush
            face.state.gaze_x, face.state.gaze_y = act.gaze_x, act.gaze_y
            face.update(dt)
            img = face.render()
            display.show(img)

            if sim and not _sim_window(img, frame, pos, wheels, brain, sensors):
                break
            time.sleep(max(0.0, period - (time.monotonic() - now)))
    finally:
        wheels.stop()
        log.info("Pío se va a dormir. ¡Hasta luego!")


def _sim_window(img, frame, pos, wheels, brain, sensors) -> bool:
    try:
        import cv2  # noqa: PLC0415

        cv2.imshow("Pio (simulador)", sim_hud(img, frame, pos, wheels.speed, brain.state, brain.energy))
        key = cv2.waitKey(1) & 0xFF
    except Exception:
        return True  # OpenCV sin GUI: el simulador corre "a ciegas" (mira los logs)
    if key == ord("q"):
        return False
    if key == ord("l"):
        sensors.sim_cliff_l = sensors.sim_cliff_r = not (sensors.sim_cliff_l and sensors.sim_cliff_r)
    elif key == ord("c"):
        sensors.sim_cliff_l = not sensors.sim_cliff_l
    elif key == ord("o"):
        sensors.sim_obstacle = not sensors.sim_obstacle
    return True


if __name__ == "__main__":
    main()
