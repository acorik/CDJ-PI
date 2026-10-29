"""Calibra el centro de cada servo y lo guarda en config.yaml (servos.trim).

Antes de atornillar los brazos de los servos: ejecuta esto, pon cada servo a 0 y monta el
brazo lo más centrado posible; luego afina aquí con el trim.

    python scripts/calibrar_servos.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from pio import config as config_mod  # noqa: E402
from pio.hardware import Servos  # noqa: E402

CONFIG = ROOT / "config.yaml"
HINTS = {
    "pan": "la cabeza mira recta al frente",
    "tilt": "la visera queda vertical (ni mira arriba ni abajo)",
    "roll": "la cabeza está derecha, sin ladear",
    "antenna_l": "la antena izquierda apunta recta hacia arriba",
    "antenna_r": "la antena derecha apunta recta hacia arriba",
}


def main():
    cfg = config_mod.load(CONFIG)
    sv = Servos(cfg["servos"], sim="--sim" in sys.argv)
    trims = dict(cfg["servos"]["trim"])
    print("Escribe un número de grados para probar un trim (p. ej. 4 o -3), Enter vacío para aceptarlo.\n")
    for name in sv.ch:
        trim = float(trims.get(name, 0))
        while True:
            sv.trim[name] = trim
            sv.pos[name] = 0.0
            sv.update({name: 0.0}, 1.0)
            ans = input(f"{name:10s} trim={trim:+.0f}  ({HINTS.get(name, '')}) > ").strip()
            if not ans:
                break
            try:
                trim = float(ans)
            except ValueError:
                print("  un número, por favor")
        trims[name] = int(round(trim))

    text = CONFIG.read_text(encoding="utf-8")
    line = "  trim: {" + ", ".join(f"{k}: {v}" for k, v in trims.items()) + "}"
    text, n = re.subn(r"^  trim: \{.*\}", line, text, flags=re.M)
    if n != 1:
        print(f"\nNo encuentro la línea 'trim:' en {CONFIG}; añádela a mano bajo 'servos:':\n{line}")
        return
    CONFIG.write_text(text, encoding="utf-8")
    print(f"\nGuardado en {CONFIG}:\n{line}")


if __name__ == "__main__":
    main()
