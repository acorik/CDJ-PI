"""Cara de Pío: dibuja los ojos en una imagen PIL según el ánimo, la mirada y el parpadeo.

Es puro (sin hardware): la misma imagen sirve para la pantalla SPI y para el simulador.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass

from PIL import Image, ImageDraw

BG = (8, 10, 20)
EYE = (166, 242, 255)
BLUSH = (255, 120, 150)

# Forma de cada ánimo: (escala alto ojo, párpado superior 0..1, párpado inferior "sonrisa" 0..1, inclinación cejas)
MOODS: dict[str, tuple[float, float, float, float]] = {
    "neutral":   (1.00, 0.00, 0.00, 0.0),
    "happy":     (0.95, 0.00, 0.30, 0.0),   # párpado inferior que sonríe
    "curious":   (1.10, 0.00, 0.00, 0.0),   # uno más grande que otro (ver draw)
    "surprised": (1.25, 0.00, 0.00, 0.0),
    "sleepy":    (0.90, 0.55, 0.00, 0.0),
    "sad":       (0.95, 0.30, 0.00, 0.35),    # cejas caídas hacia fuera
    "annoyed":   (0.90, 0.40, 0.00, -0.35),   # cejas en V
}


@dataclass
class FaceState:
    mood: str = "neutral"
    gaze_x: float = 0.0  # -1 (izq.) .. 1 (der.)
    gaze_y: float = 0.0  # -1 (arriba) .. 1 (abajo)
    blush: bool = False


class Face:
    def __init__(self, width: int = 320, height: int = 240, rng: random.Random | None = None):
        self.w, self.h = width, height
        self.rng = rng or random.Random()
        self.state = FaceState()
        self._blink_t = 0.0          # tiempo restante del parpadeo en curso
        self._next_blink = 2.5
        self._gx = self._gy = 0.0    # mirada suavizada

    # --- animación -----------------------------------------------------
    def update(self, dt: float) -> None:
        k = min(1.0, dt * 12)  # los ojos son rápidos, como los de un pájaro
        self._gx += (self.state.gaze_x - self._gx) * k
        self._gy += (self.state.gaze_y - self._gy) * k
        if self._blink_t > 0:
            self._blink_t = max(0.0, self._blink_t - dt)
        else:
            self._next_blink -= dt
            if self._next_blink <= 0 and self.state.mood != "sleepy":
                self.blink()

    def blink(self) -> None:
        self._blink_t = 0.16
        # a veces parpadea dos veces seguidas: le da vida
        self._next_blink = 0.25 if self.rng.random() < 0.15 else self.rng.uniform(2.0, 6.0)

    def openness(self) -> float:
        """1 = abierto, 0 = cerrado (curva triangular durante el parpadeo)."""
        if self._blink_t <= 0:
            return 1.0
        return abs(self._blink_t - 0.08) / 0.08

    # --- dibujo --------------------------------------------------------
    def render(self) -> Image.Image:
        img = Image.new("RGB", (self.w, self.h), BG)
        d = ImageDraw.Draw(img)
        mood = self.state.mood if self.state.mood in MOODS else "neutral"
        scale_h, lid_top, smile, brow = MOODS[mood]
        open_ = self.openness()

        base_r = self.h * 0.26
        spacing = self.w * 0.25
        cx0, cy0 = self.w / 2 + self._gx * self.w * 0.08, self.h * 0.47 + self._gy * self.h * 0.10

        for side in (-1, 1):
            r = base_r
            if mood == "curious":
                r *= 1.12 if side == 1 else 0.88
            rx, ry = r * 0.82, r * scale_h * open_
            cx = cx0 + side * spacing
            if ry < 3:  # ojo cerrado: una rayita (o una sonrisa si duerme)
                d.line([(cx - rx, cy0), (cx + rx, cy0)], fill=EYE, width=6)
                continue
            d.ellipse([cx - rx, cy0 - ry, cx + rx, cy0 + ry], fill=EYE)
            # brillos (lo que lo hace mono de verdad)
            d.ellipse([cx + rx * 0.15, cy0 - ry * 0.55, cx + rx * 0.55, cy0 - ry * 0.15], fill=(255, 255, 255))
            d.ellipse([cx - rx * 0.45, cy0 + ry * 0.25, cx - rx * 0.25, cy0 + ry * 0.45], fill=(255, 255, 255))
            # párpado superior (con inclinación = "ceja")
            if lid_top > 0 or brow:
                tilt = brow * side * ry
                top = cy0 - ry + lid_top * 2 * ry
                d.polygon([(cx - rx - 2, cy0 - ry - 4), (cx + rx + 2, cy0 - ry - 4),
                           (cx + rx + 2, top + tilt), (cx - rx - 2, top - tilt)], fill=BG)
            # párpado inferior curvo: ojos sonrientes ^^
            if smile > 0:
                cut = ry * (1.0 - smile * 1.4)
                d.ellipse([cx - rx * 1.3, cy0 + cut, cx + rx * 1.3, cy0 + cut + ry * 2.2], fill=BG)

        if self.state.blush or mood == "happy":
            for side in (-1, 1):
                bx, by = self.w / 2 + side * self.w * 0.40, self.h * 0.80
                d.ellipse([bx - 18, by - 8, bx + 18, by + 8], fill=BLUSH)
        return img


def breathing(t: float, period: float = 4.0) -> float:
    """Oscilación suave 0..1 (para dormir / reposo)."""
    return 0.5 - 0.5 * math.cos(2 * math.pi * t / period)
