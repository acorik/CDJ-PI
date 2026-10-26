"""Mide cuánto tarda en "pensar" la VLM en tu Pi (lanza antes llama-server).

    python scripts/bench_vlm.py foto.jpg -n 5
"""
import argparse
import statistics
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pio.vlm import VLMWorker  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("image")
ap.add_argument("-n", type=int, default=5)
ap.add_argument("--url", default="http://127.0.0.1:8080/v1/chat/completions")
ap.add_argument("--width", type=int, default=384)
args = ap.parse_args()

frame = np.asarray(Image.open(args.image).convert("RGB"))[..., ::-1]  # a BGR, como la cámara
w = VLMWorker(args.url, "Describe what you see in one short sentence.", jpeg_width=args.width)
times = []
for i in range(args.n):
    t0 = time.monotonic()
    caption = w.ask(frame)
    times.append(time.monotonic() - t0)
    print(f"[{i + 1}/{args.n}] {times[-1]:.1f}s  {caption.strip()}")
print(f"mediana: {statistics.median(times):.1f}s  ->  pon vlm.every_s >= {2 * statistics.median(times):.0f}")
