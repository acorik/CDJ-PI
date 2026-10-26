"""Animaciones de Pío: gestos con keyframes para cuello, antenas, ruedas, ojos y voz.

Cada animación es una lista de pistas (una por canal) con keyframes `(t, valor, easing)`,
más eventos puntuales (`say`, `mood`, `blink`, `blush`). El `Player` las mezcla encima de
lo que decide el cerebro:

- cuello (pan/tilt/roll): **se suma** a la pose del cerebro, así puede asentir mientras
  te sigue con la mirada;
- antenas, ruedas y mirada: **sustituyen** al cerebro, con un fundido de 0,15 s para que
  nada pegue saltos;
- las ruedas nunca se tocan si el cerebro las bloquea (en brazos, durmiendo o en pleno
  reflejo anti-caída).

Para crear una animación nueva, añádela a `LIBRARY` y prévisualízala con
`python scripts/preview_animaciones.py <nombre>`.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Callable

# ---------------------------------------------------------------- easing
EASES: dict[str, Callable[[float], float]] = {
    "linear": lambda x: x,
    "in": lambda x: x * x,
    "out": lambda x: 1 - (1 - x) ** 2,
    "in_out": lambda x: x * x * (3 - 2 * x),
    # se pasa un poco y vuelve: da sensación de muelle (muy de dibujo animado)
    "back": lambda x: 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2,
    "step": lambda x: 1.0 if x >= 1 else 0.0,
}

ADDITIVE = {"pan", "tilt", "roll"}
OVERRIDE = {"antenna_l", "antenna_r", "left", "right", "gaze_x", "gaze_y"}
WHEELS = {"left", "right"}
CHANNELS = ADDITIVE | OVERRIDE
FADE_S = 0.15

Key = tuple[float, float, str]  # (segundo, valor, easing con el que se LLEGA a este key)


def k(t: float, v: float, ease: str = "in_out") -> Key:
    return (t, v, ease)


def osc(t0: float, t1: float, amp: float, hz: float, center: float = 0.0, ease: str = "in_out") -> list[Key]:
    """Oscilación entre t0 y t1 (empieza y acaba en `center`): para menear, bailar, temblar."""
    keys = [k(t0, center, ease)]
    half = 0.5 / hz
    n = max(1, int((t1 - t0) / half) - 1)
    for i in range(1, n + 1):
        keys.append(k(t0 + i * half, center + amp * (1 if i % 2 else -1), ease))
    keys.append(k(t1, center, ease))
    return keys


def sample(keys: list[Key], t: float) -> float:
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, v0, _), (t1, v1, ease) in zip(keys, keys[1:]):
        if t <= t1:
            x = (t - t0) / (t1 - t0) if t1 > t0 else 1.0
            return v0 + (v1 - v0) * EASES[ease](x)
    return keys[-1][1]


@dataclass
class Anim:
    name: str
    tracks: dict[str, list[Key]]
    events: list[tuple[float, str, object]] = field(default_factory=list)
    priority: int = 1          # una animación solo interrumpe a otra de prioridad <= la suya
    description: str = ""

    @property
    def duration(self) -> float:
        ends = [keys[-1][0] for keys in self.tracks.values()] + [e[0] for e in self.events]
        return max(ends, default=0.0)


# ---------------------------------------------------------------- reproductor
class Player:
    def __init__(self, library: dict[str, Anim] | None = None):
        self.library = library if library is not None else LIBRARY
        self.current: Anim | None = None
        self.t0 = 0.0
        self._elapsed_prev = -1.0
        self._mood: str | None = None
        self._blush = False

    @property
    def busy(self) -> bool:
        return self.current is not None

    def play(self, name: str, now: float) -> bool:
        anim = self.library.get(name)
        if anim is None:
            return False
        if self.current is not None and anim.priority < self.current.priority:
            return False
        self.current, self.t0, self._elapsed_prev = anim, now, -1.0
        self._mood, self._blush = None, False
        return True

    def stop(self) -> None:
        self.current = None

    def apply(self, act, now: float):
        """Devuelve una copia de `act` (brain.Actions) con la animación en curso mezclada."""
        anim = self.current
        if anim is None:
            return act
        e = now - self.t0
        if e > anim.duration:
            self.current = None
            return act
        out = replace(act)

        # eventos que caen entre el tick anterior y este (cada uno se dispara una sola vez)
        for t, kind, value in anim.events:
            if self._elapsed_prev < t <= e:
                if kind == "say":
                    out.say = value
                elif kind == "mood":
                    self._mood = value
                elif kind == "blush":
                    self._blush = bool(value)
                elif kind == "blink":
                    out.blink = True
        self._elapsed_prev = e
        if self._mood:
            out.mood = self._mood
        out.blush = out.blush or self._blush

        w = min(1.0, e / FADE_S, (anim.duration - e) / FADE_S) if anim.duration > 2 * FADE_S else 1.0
        for ch, keys in anim.tracks.items():
            v = sample(keys, e)
            if ch in ADDITIVE:
                setattr(out, ch, getattr(out, ch) + v)
            elif ch in WHEELS and out.lock_wheels:
                continue
            else:
                setattr(out, ch, getattr(out, ch) * (1 - w) + v * w)
        return out


# ---------------------------------------------------------------- librería de gestos
# Convenios: pan + = mira a SU izquierda; tilt + = mira arriba; roll + = ladea a SU derecha.
# Antenas: + = hacia arriba/delante. Ruedas: -1..1 (atrás..adelante). Mirada: -1..1.
LIBRARY: dict[str, Anim] = {}


def _add(a: Anim) -> None:
    LIBRARY[a.name] = a


_add(Anim("hola", priority=2, description="saluda: cabeza arriba, antena que saluda y meneíto", tracks={
    "tilt": [k(0, 0), k(0.25, 14, "out"), k(0.55, -4), k(0.9, 0)],
    "roll": [k(0, 0), k(0.3, 10, "back"), k(1.0, 10), k(1.4, 0)],
    "antenna_l": [k(0, 0), k(0.2, 45, "out")] + osc(0.2, 1.2, 25, 3, center=30)[1:] + [k(1.5, 0)],
    "antenna_r": [k(0, 0), k(0.3, 20), k(1.3, 20), k(1.5, 0)],
    "left": [k(0, 0)] + osc(0.9, 1.5, 0.35, 4)[1:],
    "right": [k(0, 0)] + osc(0.9, 1.5, -0.35, 4)[1:],
}, events=[(0, "say", "hello"), (0, "mood", "happy"), (0.05, "blink", 1)]))

_add(Anim("si", description="asiente dos veces", tracks={
    "tilt": [k(0, 0), k(0.15, -12, "out"), k(0.35, 8), k(0.55, -10), k(0.75, 6), k(1.0, 0)],
}, events=[(0.1, "mood", "happy")]))

_add(Anim("no", description="niega con la cabeza", tracks={
    "pan": [k(0, 0), k(0.15, 18, "out"), k(0.35, -18), k(0.55, 14), k(0.75, -10), k(1.0, 0)],
    "gaze_x": [k(0, 0), k(0.1, -0.6), k(0.3, 0.6), k(0.5, -0.5), k(0.7, 0.4), k(1.0, 0)],
}, events=[(0, "mood", "annoyed"), (0.05, "say", "annoyed")]))

_add(Anim("eh", priority=2, description="¿eh? ladea la cabeza, una antena arriba", tracks={
    "roll": [k(0, 0), k(0.35, 20, "back"), k(1.6, 20), k(2.2, 0)],
    "tilt": [k(0, 0), k(0.35, 6), k(1.6, 6), k(2.2, 0)],
    "antenna_l": [k(0, 0), k(0.3, 40, "back"), k(1.7, 40), k(2.2, 0)],
    "antenna_r": [k(0, 0), k(0.3, -15), k(1.7, -15), k(2.2, 0)],
    "gaze_y": [k(0, 0), k(0.3, -0.3), k(1.7, -0.3), k(2.2, 0)],
}, events=[(0, "mood", "curious"), (0.3, "say", "curious")]))

_add(Anim("feliz", priority=2, description="bailecito de pato: se contonea y aletea las antenas", tracks={
    "roll": osc(0, 2.4, 12, 2.5),
    "tilt": osc(0, 2.4, 5, 5, center=4),
    "antenna_l": osc(0, 2.4, 35, 4, center=15),
    "antenna_r": osc(0, 2.4, -35, 4, center=15),
    "left": osc(0.1, 2.2, 0.35, 2),
    "right": osc(0.1, 2.2, -0.35, 2),
}, events=[(0, "mood", "happy"), (0, "blush", 1), (0.1, "say", "happy")]))

_add(Anim("susto", priority=3, description="se asusta: da un respingo hacia atrás", tracks={
    "tilt": [k(0, 0), k(0.08, 18, "out"), k(0.6, 14), k(1.6, 0)],
    "pan": [k(0, 0)] + osc(0.08, 0.5, 4, 12)[1:] + [k(1.6, 0)],
    "antenna_l": [k(0, 0), k(0.08, 45, "out"), k(1.0, 45), k(1.6, 0)],
    "antenna_r": [k(0, 0), k(0.08, 45, "out"), k(1.0, 45), k(1.6, 0)],
    "left": [k(0, 0), k(0.05, -0.6, "step"), k(0.35, -0.6), k(0.4, 0)],
    "right": [k(0, 0), k(0.05, -0.6, "step"), k(0.35, -0.6), k(0.4, 0)],
}, events=[(0, "mood", "surprised"), (0, "say", "surprised")]))

_add(Anim("bostezo", description="bosteza y se estira", tracks={
    "tilt": [k(0, 0), k(1.0, 20), k(1.8, 20), k(2.5, -6), k(3.0, 0)],
    "roll": [k(0, 0), k(1.0, -8), k(2.6, 0)],
    "antenna_l": [k(0, 0), k(1.0, 40), k(2.4, -20), k(3.0, 0)],
    "antenna_r": [k(0, 0), k(1.0, 40), k(2.4, -20), k(3.0, 0)],
}, events=[(0, "mood", "sleepy"), (0.8, "say", "sleepy"), (2.6, "blink", 1), (2.8, "mood", "neutral")]))

_add(Anim("estornudo", description="a... a... ¡achís! y sacude la cabeza", tracks={
    "tilt": [k(0, 0), k(0.4, 10), k(0.8, 14), k(1.2, 18, "in"), k(1.32, -15, "out"), k(1.8, -4), k(2.4, 0)],
    "roll": [k(0, 0), k(1.6, 0)] + osc(1.6, 2.2, 10, 6)[1:] + [k(2.4, 0)],
    "antenna_l": [k(0, 0), k(1.2, 30, "in"), k(1.3, -30, "out"), k(2.0, 0)],
    "antenna_r": [k(0, 0), k(1.2, 30, "in"), k(1.3, -30, "out"), k(2.0, 0)],
    "left": [k(0, 0), k(1.25, 0), k(1.28, -0.7, "step"), k(1.45, -0.7), k(1.5, 0)],
    "right": [k(0, 0), k(1.25, 0), k(1.28, -0.7, "step"), k(1.45, -0.7), k(1.5, 0)],
}, events=[(0.3, "mood", "sleepy"), (0.4, "say", "sneeze"), (1.3, "mood", "surprised"), (1.8, "blink", 1),
           (2.0, "mood", "happy")]))

_add(Anim("triste", description="baja la cabeza y las antenas", tracks={
    "tilt": [k(0, 0), k(1.0, -18), k(2.4, -18), k(3.0, 0)],
    "roll": [k(0, 0), k(1.0, -6), k(2.4, -6), k(3.0, 0)],
    "antenna_l": [k(0, 0), k(1.0, -40), k(2.6, -40), k(3.0, 0)],
    "antenna_r": [k(0, 0), k(1.0, -40), k(2.6, -40), k(3.0, 0)],
    "gaze_y": [k(0, 0), k(0.8, 0.5), k(2.6, 0.5), k(3.0, 0)],
}, events=[(0, "mood", "sad"), (0.4, "say", "sad")]))

_add(Anim("enfado", description="refunfuña: sacude rápido y echa las antenas atrás", tracks={
    "pan": osc(0, 1.2, 8, 6),
    "tilt": [k(0, 0), k(0.2, -6), k(1.4, -6), k(1.8, 0)],
    "antenna_l": [k(0, 0), k(0.2, -30), k(1.5, -30), k(1.8, 0)],
    "antenna_r": [k(0, 0), k(0.2, -30), k(1.5, -30), k(1.8, 0)],
}, events=[(0, "mood", "annoyed"), (0.1, "say", "annoyed")]))

_add(Anim("mirar_alrededor", description="los ojos van primero y el cuello detrás", tracks={
    "gaze_x": [k(0, 0), k(0.3, -0.8, "out"), k(1.4, -0.8), k(1.7, 0.8, "out"), k(3.0, 0.8), k(3.4, 0)],
    "pan": [k(0, 0), k(0.3, 0), k(0.9, 40), k(1.6, 40), k(2.4, -40), k(3.1, -40), k(3.8, 0)],
    "tilt": [k(0, 0), k(0.9, 5), k(2.4, 5), k(3.8, 0)],
}, events=[(1.0, "blink", 1), (2.6, "blink", 1)]))

_add(Anim("amor", priority=2, description="ojos de corazón, se balancea y se sonroja", tracks={
    "roll": osc(0, 2.5, 8, 0.8),
    "tilt": [k(0, 0), k(0.4, 6), k(2.1, 6), k(2.5, 0)],
    "antenna_l": osc(0, 2.5, 10, 1.6, center=25),
    "antenna_r": osc(0, 2.5, -10, 1.6, center=25),
}, events=[(0, "mood", "love"), (0, "blush", 1), (0.4, "say", "love")]))

_add(Anim("dormirse", priority=2, description="da cabezadas hasta quedarse frito", tracks={
    # cabezadas encima de la cabeza gacha que ya pone el cerebro al dormir
    "tilt": [k(0, 0), k(0.8, -10), k(1.0, 4, "out"), k(2.2, -10), k(2.35, 2, "out"), k(3.5, -5)],
    "antenna_l": [k(0, 0), k(3.5, -35)],
    "antenna_r": [k(0, 0), k(3.5, -35)],
}, events=[(0, "mood", "sleepy"), (1.0, "blink", 1), (2.0, "say", "sleepy")]))

_add(Anim("despertar", priority=2, description="se estira, parpadea y saluda", tracks={
    "tilt": [k(0, 0), k(0.3, -8), k(1.0, 15), k(1.8, 15), k(2.5, 0)],
    "roll": [k(0, 0), k(1.2, 0)] + osc(1.2, 1.8, 6, 5)[1:] + [k(2.5, 0)],
    "antenna_l": [k(0, -35), k(1.0, 45, "back"), k(2.0, 0)],
    "antenna_r": [k(0, -35), k(1.0, 45, "back"), k(2.0, 0)],
}, events=[(0, "mood", "sleepy"), (1.0, "mood", "neutral"), (1.1, "blink", 1), (1.4, "blink", 1),
           (1.6, "mood", "happy"), (1.6, "say", "hello")]))

_add(Anim("baile", priority=2, description="baile completo de 4 s (pídeselo con música)", tracks={
    "roll": osc(0, 4, 15, 2),
    "tilt": osc(0, 4, 6, 4),
    "antenna_l": osc(0, 4, 40, 2),
    "antenna_r": osc(0, 4, -40, 2),
    "left": osc(0, 4, 0.4, 1),
    "right": osc(0, 4, -0.4, 1),
}, events=[(0, "mood", "happy"), (0, "blush", 1), (0, "say", "happy"), (2.0, "say", "quack")]))

_add(Anim("giro", priority=2, description="vuelta completa de alegría (calibra la duración con tus motores)", tracks={
    "left": [k(0, 0), k(0.2, 0.8), k(1.6, 0.8), k(1.8, 0)],
    "right": [k(0, 0), k(0.2, -0.8), k(1.6, -0.8), k(1.8, 0)],
    "roll": [k(0, 0), k(0.3, 10), k(1.5, 10), k(1.9, 0)],
    "antenna_l": [k(0, 0), k(0.3, -30), k(1.5, -30), k(1.9, 0)],
    "antenna_r": [k(0, 0), k(0.3, -30), k(1.5, -30), k(1.9, 0)],
}, events=[(0, "mood", "happy"), (0.1, "say", "happy")]))

_add(Anim("pensar", description="mira arriba a un lado mientras la VLM piensa", tracks={
    "gaze_x": [k(0, 0), k(0.3, 0.6), k(2.2, 0.6), k(2.5, 0)],
    "gaze_y": [k(0, 0), k(0.3, -0.7), k(2.2, -0.7), k(2.5, 0)],
    "roll": [k(0, 0), k(0.4, 8), k(2.1, 8), k(2.5, 0)],
    "antenna_r": [k(0, 0), k(0.6, 0)] + osc(0.6, 1.4, 20, 4)[1:] + [k(2.5, 0)],
}, events=[(0, "mood", "curious")]))

_add(Anim("cuac", description="cuac con cabeceo", tracks={
    "tilt": [k(0, 0), k(0.12, -8, "out"), k(0.35, 4), k(0.8, 0)],
}, events=[(0.05, "say", "quack")]))


def describe() -> str:
    return "\n".join(f"{a.name:16s} {a.duration:4.1f}s  {a.description}" for a in LIBRARY.values())

