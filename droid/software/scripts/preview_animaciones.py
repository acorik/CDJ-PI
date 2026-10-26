"""Genera GIFs de las animaciones de Pío (no hace falta hardware).

    python scripts/preview_animaciones.py                 # todas -> animaciones.gif
    python scripts/preview_animaciones.py hola estornudo  # solo esas
    python scripts/preview_animaciones.py --each -o gifs/ # un GIF por animación
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pio.animations import LIBRARY  # noqa: E402
from pio.preview import render_animation  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("names", nargs="*", help="animaciones (por defecto, todas)")
ap.add_argument("-o", "--out", default="animaciones.gif", help="fichero .gif (o carpeta con --each)")
ap.add_argument("--each", action="store_true", help="un GIF por animación")
ap.add_argument("--fps", type=int, default=12)
ap.add_argument("--width", type=int, default=260)
args = ap.parse_args()

names = args.names or list(LIBRARY)
unknown = [n for n in names if n not in LIBRARY]
if unknown:
    sys.exit(f"no existen: {', '.join(unknown)}. Disponibles: {', '.join(LIBRARY)}")
size = (args.width, int(args.width * 340 / 300))


def save(frames, path):
    frames = [f.convert("P", palette=1, colors=64) for f in frames]  # paleta reducida: GIF ligero
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=int(1000 / args.fps), loop=0, optimize=True)
    print(f"{path}  ({len(frames)} fotogramas)")


if args.each:
    out = Path(args.out if args.out != "animaciones.gif" else "gifs")
    out.mkdir(parents=True, exist_ok=True)
    for n in names:
        save(render_animation(n, args.fps, size), out / f"{n}.gif")
else:
    save([f for n in names for f in render_animation(n, args.fps, size)], args.out)
