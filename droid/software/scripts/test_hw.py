"""Prueba el hardware de Pío pieza a pieza (ejecútalo en la Pi, con el venv activado).

    python scripts/test_hw.py              # todo, en orden
    python scripts/test_hw.py servos ruedas
Pruebas: pantalla servos ruedas sensores camara audio vlm
"""
import argparse
import sys
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from pio import config as config_mod  # noqa: E402

TESTS = ["pantalla", "servos", "ruedas", "sensores", "camara", "audio", "vlm"]


def pantalla(cfg):
    from PIL import Image, ImageDraw

    from pio.face import MOODS, Face
    from pio.hardware import Display

    disp = Display(cfg["display"], sim=False)
    w, h = cfg["display"]["width"], cfg["display"]["height"]
    bars = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(bars)
    for i, c in enumerate([(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 255)]):
        d.rectangle([i * w // 4, 0, (i + 1) * w // 4, h], fill=c)
    d.text((10, h - 20), "Hola, soy Pio", fill=(0, 0, 0))
    disp.show(bars)
    print("  ¿ves 4 barras: rojo, verde, azul, blanco (de izquierda a derecha)?")
    print("  si salen girados cambia display.rotate; si los colores van cambiados, prueba el otro driver")
    time.sleep(3)
    face = Face(w, h)
    for mood in MOODS:
        face.state.mood = mood
        disp.show(face.render())
        print(f"  ánimo: {mood}")
        time.sleep(1.0)


def servos(cfg):
    from pio.hardware import Servos

    sv = Servos(cfg["servos"], sim=False)
    for name in sv.ch:
        lo, hi = sv.limits[name]
        print(f"  {name} (canal {sv.ch[name]}): centro -> {lo} -> {hi} -> centro")
        for target in (0, lo, hi, 0):
            for _ in range(40):
                sv.update({name: target}, 0.025)
                time.sleep(0.025)
            time.sleep(0.3)


def ruedas(cfg):
    from pio.hardware import Wheels

    input("  pon a Pío con las ruedas EN EL AIRE y pulsa Enter...")
    wh = Wheels(cfg["motors"], sim=False)
    for label, l, r in [("izquierda adelante", 1, 0), ("izquierda atrás", -1, 0),
                        ("derecha adelante", 0, 1), ("derecha atrás", 0, -1)]:
        print(f"  {label}")
        wh.drive(l, r)
        time.sleep(1.0)
        wh.stop()
        time.sleep(0.4)
    print("  si alguna gira al revés, intercambia sus dos pines en config.yaml (motors.left/right)")


def sensores(cfg):
    from pio.hardware import Sensors

    se = Sensors(cfg["sensors"], sim=False)
    print("  10 s: levanta a Pío, pon la mano delante... (Ctrl+C para cortar)")
    t0 = time.monotonic()
    while time.monotonic() - t0 < 10:
        cl, cr, ob = se.read()
        print(f"\r  borde izq={'SIN SUELO' if cl else 'suelo   '}  der={'SIN SUELO' if cr else 'suelo   '}"
              f"  obstáculo={'SÍ' if ob else 'no'}   ", end="", flush=True)
        time.sleep(0.2)
    print()


def camara(cfg):
    from PIL import Image

    from pio.hardware import Camera
    from pio.vision import FaceDetector

    cam = Camera(cfg["camera"], sim=False)
    time.sleep(1.0)  # que ajuste la exposición
    frame = cam.read()
    out = Path.home() / "pio_camara.jpg"  # en tu carpeta, no en /tmp (compartida con otros usuarios)
    Image.fromarray(frame[..., ::-1]).save(out)
    print(f"  foto {frame.shape[1]}x{frame.shape[0]} guardada en {out}")
    face = FaceDetector().detect(frame)
    print(f"  cara: {face}" if face else "  no veo ninguna cara (ponte delante y repite)")


def audio(cfg):
    from pio.sounds import PHRASES, Voice

    v = Voice(enabled=True, volume=cfg["audio"]["volume"])
    if v._sd is None:
        raise RuntimeError("sounddevice no disponible (pip install sounddevice; apt install libportaudio2)")
    for name in PHRASES:
        print(f"  {name}")
        v.say(name)
        time.sleep(1.2)


def vlm(cfg):
    from pio.hardware import Camera
    from pio.vlm import VLMWorker

    c = cfg["vlm"]
    frame = Camera(cfg["camera"], sim=False).read()
    w = VLMWorker(c["url"], c["prompt"], c["max_tokens"], c["timeout_s"], c["jpeg_width"], allow_remote=c["allow_remote"])
    t0 = time.monotonic()
    caption = w.ask(frame)
    obs = w.interpreter.interpret(caption)
    print(f"  ({time.monotonic() - t0:.1f}s) {caption.strip()}  ->  tema={obs.topic} ánimo={obs.mood}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tests", nargs="*", help=" ".join(TESTS))
    ap.add_argument("-c", "--config", default=str(ROOT / "config.yaml"))
    args = ap.parse_args()
    bad = [t for t in args.tests if t not in TESTS]
    if bad:
        ap.error(f"no conozco {bad}; elige entre: {' '.join(TESTS)}")
    cfg = config_mod.load(args.config)
    results = {}
    for name in args.tests or TESTS:
        print(f"\n== {name} ==")
        try:
            globals()[name](cfg)
            results[name] = "OK"
        except KeyboardInterrupt:
            results[name] = "cortado"
        except Exception as e:
            traceback.print_exc(limit=1)
            results[name] = f"FALLO: {e}"
    print("\nResumen:")
    for name, r in results.items():
        print(f"  {name:9s} {r}")


if __name__ == "__main__":
    main()
