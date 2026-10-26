import random

import numpy as np

from pio.face import MOODS, Face
from pio.sounds import PHRASES, synth


def test_renders_every_mood():
    f = Face(320, 240, rng=random.Random(0))
    for mood in MOODS:
        f.state.mood = mood
        img = f.render()
        assert img.size == (320, 240)
        assert np.asarray(img).max() > 100, f"{mood}: no se ve nada"


def test_blink_closes_the_eyes():
    f = Face(320, 240, rng=random.Random(0))
    open_px = (np.asarray(f.render()) > 150).sum()
    f.blink()
    f.update(0.08)  # mitad del parpadeo
    closed_px = (np.asarray(f.render()) > 150).sum()
    assert closed_px < open_px * 0.2


def test_synth_phrases_are_normalised():
    for name, syl in PHRASES.items():
        wave = synth(syl, 16000, rng=random.Random(0))
        assert wave.dtype == np.float32 and len(wave) > 0, name
        assert np.abs(wave).max() <= 1.0001
