"""Carga de configuración: config.yaml + valores por defecto."""
from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

import yaml

DEFAULTS: dict[str, Any] = {
    "loop_hz": 20,
    "camera": {"width": 640, "height": 480, "hfov_deg": 66.0, "vfov_deg": 41.0, "index": 0},
    "display": {
        "driver": "ili9341",  # ili9341 | st7789
        "width": 320,
        "height": 240,
        "rotate": 0,
        "spi_port": 0,
        "spi_device": 0,
        "gpio_dc": 24,
        "gpio_rst": 25,
        "spi_hz": 40_000_000,
    },
    "servos": {
        "channels": {"pan": 0, "tilt": 1, "roll": 2, "antenna_l": 3, "antenna_r": 4},
        # límites mecánicos en grados respecto al centro
        "limits": {"pan": [-60, 60], "tilt": [-20, 25], "roll": [-25, 25], "antenna_l": [-40, 40], "antenna_r": [-40, 40]},
        "trim": {"pan": 0, "tilt": 0, "roll": 0, "antenna_l": 0, "antenna_r": 0},
        "max_deg_per_s": 180,
    },
    "motors": {"left": [12, 13], "right": [16, 26], "max_speed": 0.6},
    "sensors": {"cliff_left": 5, "cliff_right": 6, "tof": True, "obstacle_mm": 120},
    "vlm": {
        "url": "http://127.0.0.1:8080/v1/chat/completions",
        "every_s": 20.0,
        "timeout_s": 60.0,
        "max_tokens": 48,
        "jpeg_width": 384,
        "prompt": "Describe what you see in one short sentence.",
    },
    "audio": {"enabled": True, "volume": 0.5, "sample_rate": 22050},
    "diary": "~/.pio/diario.jsonl",
}


def _merge(base: dict, extra: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (extra or {}).items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def load(path: str | Path | None) -> dict[str, Any]:
    if path is None:
        return copy.deepcopy(DEFAULTS)
    with open(path, encoding="utf-8") as f:
        return _merge(DEFAULTS, yaml.safe_load(f) or {})
