"""Comportamiento de Pío: máquina de estados + emociones.

Reflejos rápidos (cada tick, ~20 Hz): seguir caras, no caerse de la mesa, parpadear.
Pensamiento lento (cada ~20 s): lo que diga la VLM cambia su ánimo y su curiosidad.

Es lógica pura: recibe `Percepts` y devuelve `Actions`, así se puede testear sin hardware.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from .vlm import Observation


@dataclass
class Face:
    x: float      # -1 (izq.) .. 1 (der.) en la imagen
    y: float      # -1 (arriba) .. 1 (abajo)
    size: float   # ancho de la cara / ancho de la imagen


@dataclass
class Percepts:
    t: float
    face: Face | None = None
    cliff_left: bool = False    # True = no hay suelo bajo ese sensor
    cliff_right: bool = False
    obstacle: bool = False
    observation: Observation | None = None


@dataclass
class Actions:
    pan: float = 0.0
    tilt: float = 0.0
    roll: float = 0.0
    antenna_l: float = 0.0
    antenna_r: float = 0.0
    left: float = 0.0           # velocidad rueda -1..1
    right: float = 0.0
    mood: str = "neutral"
    gaze_x: float = 0.0
    gaze_y: float = 0.0
    blush: bool = False
    say: str | None = None
    want_vlm: bool = False


@dataclass
class Brain:
    hfov: float = 66.0
    vfov: float = 41.0
    vlm_every_s: float = 20.0
    rng: random.Random = field(default_factory=random.Random)

    state: str = "IDLE"          # SLEEP | IDLE | TRACK | EXPLORE | CURIOUS | LIFTED
    energy: float = 0.8          # 0..1, baja despierto y sube durmiendo
    since: float = 0.0
    last_face_t: float = -1e9
    last_greet_t: float = -1e9
    last_vlm_t: float = -1e9
    pan: float = 0.0
    tilt: float = 0.0
    _gaze_target: tuple[float, float, float] = (0.0, 0.0, 0.0)
    _next_saccade: float = 0.0
    _reflex_until: float = -1.0
    _reflex_dir: float = 1.0
    _wander_turn: float = 0.0
    _curious: Observation | None = None
    _roll_sign: float = 1.0
    _t: float | None = None

    # ------------------------------------------------------------------
    def _go(self, state: str, t: float) -> None:
        if state != self.state:
            self.state, self.since = state, t

    def vlm_sent(self, t: float) -> None:
        self.last_vlm_t = t

    def step(self, p: Percepts) -> Actions:
        dt = 0.0 if self._t is None else max(0.0, min(0.5, p.t - self._t))
        self._t = t = p.t
        a = Actions()

        # --- energía -----------------------------------------------------
        moving = self.state == "EXPLORE"
        if self.state == "SLEEP":
            self.energy = min(1.0, self.energy + dt / 300)
        else:
            self.energy = max(0.0, self.energy - dt / (600 if moving else 1200))

        # --- prioridad 1: ¡me han cogido en brazos! -------------------------
        lifted = p.cliff_left and p.cliff_right
        if lifted:
            if self.state != "LIFTED":
                a.say = "surprised"
                self._go("LIFTED", t)
            return self._lifted(a, t)
        if self.state == "LIFTED":
            a.say = "happy"   # alivio al volver al suelo
            self._go("IDLE", t)

        # --- prioridad 2: dormir ------------------------------------------
        if self.state == "SLEEP":
            if self.energy > 0.95 or (p.face and self.energy > 0.3):
                a.say = "hello" if p.face else None
                self._go("TRACK" if p.face else "IDLE", t)
            else:
                return self._sleep(a, t)
        elif self.energy < 0.12:
            a.say = "sleepy"
            self._go("SLEEP", t)
            return self._sleep(a, t)

        # --- percepciones -> transiciones ---------------------------------
        if p.face:
            if t - self.last_face_t > 30 and t - self.last_greet_t > 30:
                a.say, self.last_greet_t = "hello", t
            self.last_face_t = t
            if self.state != "CURIOUS":
                self._go("TRACK", t)
        elif self.state == "TRACK" and t - self.last_face_t > 3.0:
            self._go("IDLE", t)

        obs = p.observation
        if obs:
            if obs.topic == "dark":
                self.energy = max(0.0, self.energy - 0.05)
            if obs.interest >= 0.6:
                self._curious = obs
                self._roll_sign = self.rng.choice([-1.0, 1.0])
                a.say = a.say or {"surprised": "surprised", "happy": "happy"}.get(obs.mood, "curious")
                self._go("CURIOUS", t)

        if self.state == "IDLE" and t - self.since > 30 and self.energy > 0.5:
            self._go("EXPLORE", t)
        elif self.state == "EXPLORE" and t - self.since > 15:
            self._go("IDLE", t)
        elif self.state == "CURIOUS" and t - self.since > 4.0:
            self._curious = None
            self._go("TRACK" if p.face else "IDLE", t)

        # --- comportamiento del estado -----------------------------------
        {"IDLE": self._idle, "TRACK": self._track, "EXPLORE": self._explore, "CURIOUS": self._curious_b}[self.state](a, p, t)

        # --- reflejo anti-caída (por encima de todo lo que mueva ruedas) ----
        if p.cliff_left or p.cliff_right:
            self._reflex_until = t + 0.6
            self._reflex_dir = 1.0 if p.cliff_left else -1.0
        if t < self._reflex_until:
            a.left, a.right = -0.4 + 0.2 * self._reflex_dir, -0.4 - 0.2 * self._reflex_dir
            a.mood = "surprised"

        a.want_vlm = t - self.last_vlm_t >= self.vlm_every_s
        a.pan, a.tilt = self.pan, self.tilt
        return a

    # ------------------------------------------------------------------
    def _look(self, pan: float, tilt: float, k: float) -> None:
        self.pan += (pan - self.pan) * k
        self.tilt += (tilt - self.tilt) * k

    def _antenna_wiggle(self, a: Actions, t: float, amp: float, hz: float) -> None:
        a.antenna_l = amp * math.sin(2 * math.pi * hz * t)
        a.antenna_r = -a.antenna_l

    def _sleep(self, a: Actions, t: float) -> Actions:
        a.mood = "sleepy"
        self._look(0, -15 - 3 * math.sin(t * 2 * math.pi / 4), 0.05)  # cabeza gacha, respirando
        a.antenna_l = a.antenna_r = -35
        a.pan, a.tilt = self.pan, self.tilt
        return a

    def _lifted(self, a: Actions, t: float) -> Actions:
        a.mood = "surprised" if t - self.since < 1.5 else "happy"
        a.blush = True
        self._look(25 * math.sin(t * 3), 10, 0.2)  # mira a todos lados: ¿dónde voy?
        self._antenna_wiggle(a, t, 30, 3)
        a.pan, a.tilt = self.pan, self.tilt
        return a

    def _idle(self, a: Actions, p: Percepts, t: float) -> None:
        if t >= self._next_saccade:  # mirar alrededor a saltitos, como un pájaro
            self._gaze_target = (self.rng.uniform(-45, 45), self.rng.uniform(-10, 15),
                                 self.rng.choice([0, 0, 0, -12, 12]))
            self._next_saccade = t + self.rng.uniform(1.5, 4.0)
            if self.rng.random() < 0.06:
                a.say = "quack"
        pan, tilt, roll = self._gaze_target
        self._look(pan, tilt, 0.25)
        a.roll = roll
        a.gaze_x, a.gaze_y = (pan - self.pan) / 45, -(tilt - self.tilt) / 20
        a.mood = "neutral" if self.energy > 0.3 else "sleepy"

    def _track(self, a: Actions, p: Percepts, t: float) -> None:
        a.mood = "happy"
        if p.face:
            # la mirada (ojos) va directa; el cuello la sigue con suavidad
            a.gaze_x, a.gaze_y = p.face.x, p.face.y
            self._look(self.pan - p.face.x * self.hfov / 2, self.tilt - p.face.y * self.vfov / 2, 0.15)
            a.blush = p.face.size > 0.35  # ¡demasiado cerca! (se sonroja)
            # si el cuello va al límite, gira el cuerpo entero
            if abs(self.pan) > 40:
                turn = 0.25 * math.copysign(1, self.pan)
                a.left, a.right = -turn, turn
            self._antenna_wiggle(a, t, 15, 1.5)

    def _explore(self, a: Actions, p: Percepts, t: float) -> None:
        a.mood = "neutral"
        if p.obstacle:
            a.left, a.right = -0.3, 0.3  # gira sobre sí mismo
            self._look(-30, 0, 0.2)
            return
        if self.rng.random() < 0.02:
            self._wander_turn = self.rng.uniform(-0.15, 0.15)
        a.left, a.right = 0.3 + self._wander_turn, 0.3 - self._wander_turn
        self._look(self._wander_turn * 150, -8, 0.1)  # mira hacia donde gira

    def _curious_b(self, a: Actions, p: Percepts, t: float) -> None:
        obs = self._curious
        a.mood = obs.mood if obs and obs.mood != "neutral" else "curious"
        a.roll = 18 * self._roll_sign   # el gesto "¿eh?"
        a.antenna_l, a.antenna_r = 30, -10
        if p.face:
            a.gaze_x, a.gaze_y = p.face.x, p.face.y
