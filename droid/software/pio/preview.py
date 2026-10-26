"""Dibuja a Pío de frente (2D) con una pose dada: para previsualizar animaciones sin hardware."""
from __future__ import annotations

import math

from PIL import Image, ImageDraw

from .animations import Player
from .brain import Actions
from .face import Face

CREAM, ORANGE, DARK, PINK = (243, 239, 228), (255, 159, 28), (31, 34, 51), (255, 143, 163)
BG, INK = (250, 250, 247), (60, 60, 70)


def draw_pio(face_img: Image.Image, act: Actions, size: tuple[int, int] = (300, 340)) -> Image.Image:
    W, H = size
    s = W / 300  # todo está pensado a 300 px de ancho
    img = Image.new("RGB", size, BG)
    d = ImageDraw.Draw(img)
    cx = W / 2

    # ruedas / pies (+ flechas de velocidad: arriba = adelante)
    for side, v in ((-1, act.right), (1, act.left)):  # visto de frente: su izquierda a nuestra derecha
        fx = cx + side * 62 * s
        d.rounded_rectangle([fx - 16 * s, 262 * s, fx + 16 * s, 312 * s], 8 * s, fill=DARK)
        d.rounded_rectangle([fx - 20 * s, 250 * s, fx + 20 * s, 288 * s], 12 * s, fill=ORANGE)
        d.ellipse([fx - 22 * s, 304 * s, fx + 22 * s, 318 * s], fill=ORANGE)
        if abs(v) > 0.02:
            ax = fx + side * 34 * s
            tip = 285 * s - math.copysign(30 * s * min(1, abs(v) / 0.6), v)
            col = (46, 160, 90) if v > 0 else (220, 70, 70)
            d.line([ax, 285 * s, ax, tip], fill=col, width=int(5 * s))
            d.polygon([(ax - 7 * s, tip + math.copysign(6 * s, v)), (ax + 7 * s, tip + math.copysign(6 * s, v)),
                       (ax, tip - math.copysign(4 * s, v))], fill=col)

    # cuerpo y cuello
    d.ellipse([cx - 70 * s, 168 * s, cx + 70 * s, 292 * s], fill=CREAM, outline=(215, 210, 198), width=2)
    d.rectangle([cx - 16 * s, 150 * s, cx + 16 * s, 178 * s], fill=DARK)
    d.rectangle([cx - 20 * s, 164 * s, cx + 20 * s, 170 * s], fill=ORANGE)

    # cabeza en su propia capa: se desplaza con pan/tilt y se rota con roll
    pad = int(30 * s)  # margen para que la cabeza no se recorte al ladearse
    hw, hh = int(170 * s) + 2 * pad, int(150 * s) + 2 * pad
    head = Image.new("RGBA", (hw, hh), (0, 0, 0, 0))
    hd = ImageDraw.Draw(head)
    top = 38 * s + pad
    hd.rounded_rectangle([5 * s + pad, top, hw - 5 * s - pad, top + 100 * s], 30 * s, fill=CREAM, outline=(215, 210, 198), width=2)
    # antenas: + = erguidas, - = caídas hacia fuera
    for side, v in ((-1, act.antenna_r), (1, act.antenna_l)):
        bx = hw / 2 + side * 40 * s
        ang = math.radians(15 + max(0.0, -v) * 1.3 - max(0.0, v) * 0.3)
        length = (30 + max(0.0, v) * 0.15) * s
        tx, ty = bx + side * math.sin(ang) * length, top + 2 - math.cos(ang) * length
        hd.line([bx, top + 4, tx, ty], fill=DARK, width=max(2, int(3 * s)))
        hd.ellipse([tx - 6 * s, ty - 6 * s, tx + 6 * s, ty + 6 * s], fill=ORANGE)
    # visera con la cara; la cara se mueve dentro según hacia dónde mira el cuello
    vx0, vy0, vw, vh = 27 * s + pad, top + 14 * s, int(116 * s), int(64 * s)
    hd.rounded_rectangle([vx0 - 3, vy0 - 3, vx0 + vw + 3, vy0 + vh + 3], 16 * s, fill=DARK)
    fimg = face_img.resize((vw, int(vw * face_img.height / face_img.width)))
    ox = int(max(-1, min(1, act.pan / 60)) * 10 * s)
    oy = int(-max(-1, min(1, act.tilt / 25)) * 6 * s) - (fimg.height - vh) // 2
    crop = Image.new("RGB", (vw, vh), (8, 10, 20))
    crop.paste(fimg, (ox, oy))
    mask = Image.new("L", (vw, vh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, vw - 1, vh - 1], 14 * s, fill=255)
    head.paste(crop, (int(vx0), int(vy0)), mask)
    # pico
    hd.ellipse([hw / 2 - 24 * s, vy0 + vh + 2 * s, hw / 2 + 24 * s, vy0 + vh + 22 * s], fill=ORANGE)
    hd.ellipse([hw / 2 - 4 * s, vy0 + vh + 6 * s, hw / 2 + 4 * s, vy0 + vh + 14 * s], fill=(120, 70, 10))
    if act.blush:
        for side in (-1, 1):
            bx = hw / 2 + side * 66 * s
            hd.ellipse([bx - 9 * s, vy0 + vh - 4 * s, bx + 9 * s, vy0 + vh + 5 * s], fill=PINK)

    head = head.rotate(-act.roll, resample=Image.BICUBIC, center=(hw / 2, top + 100 * s))
    hx = int(cx - hw / 2 + act.pan * 0.35 * s)
    hy = int(16 * s - pad - act.tilt * 0.4 * s)
    img.paste(head, (hx, hy), head)
    return img


def render_animation(name: str, fps: int = 15, size: tuple[int, int] = (300, 340), tail_s: float = 0.4) -> list[Image.Image]:
    """Reproduce una animación sobre una pose neutra y devuelve los fotogramas."""
    player, face = Player(), Face(320, 240)
    face._next_blink = 99  # parpadeos solo los que pida la animación
    player.play(name, 0.0)
    anim = player.current
    frames, t, dt = [], 0.0, 1.0 / fps
    while t <= anim.duration + tail_s:
        act = player.apply(Actions(), t)
        face.state.mood, face.state.blush = act.mood, act.blush
        face.state.gaze_x, face.state.gaze_y = act.gaze_x, act.gaze_y
        if act.blink:
            face.blink()
        face.update(dt)
        frame = draw_pio(face.render(), act, size)
        ImageDraw.Draw(frame).text((8, 6), f"{name}  {t:3.1f}s", fill=INK)
        frames.append(frame)
        t += dt
    return frames
