import pytest

from pio.animations import CHANNELS, EASES, LIBRARY, Anim, Player, k, osc, sample
from pio.brain import Actions
from pio.face import MOODS
from pio.sounds import PHRASES


@pytest.mark.parametrize("name", list(LIBRARY))
def test_library_is_well_formed(name):
    a = LIBRARY[name]
    assert a.duration > 0
    for ch, keys in a.tracks.items():
        assert ch in CHANNELS, f"{name}: canal desconocido {ch}"
        times = [t for t, _, _ in keys]
        assert times == sorted(times), f"{name}/{ch}: keyframes desordenados"
        assert all(e in EASES for _, _, e in keys)
    for t, kind, value in a.events:
        assert kind in {"say", "mood", "blush", "blink"}
        if kind == "say":
            assert value in PHRASES, f"{name}: sonido {value} no existe"
        if kind == "mood":
            assert value in MOODS, f"{name}: ánimo {value} no existe"


@pytest.mark.parametrize("name", list(LIBRARY))
def test_every_animation_ends_at_rest(name):
    """Al acabar, el cuello vuelve a la pose del cerebro (sin tirones)."""
    a = LIBRARY[name]
    for ch in ("pan", "roll"):
        if ch in a.tracks:
            assert abs(a.tracks[ch][-1][1]) < 1e-6, f"{name}/{ch} no vuelve a 0"


def test_sample_interpolates_and_clamps():
    keys = [k(0, 0, "linear"), k(1, 10, "linear")]
    assert sample(keys, -1) == 0 and sample(keys, 0.5) == 5 and sample(keys, 2) == 10


def test_osc_starts_and_ends_at_center():
    keys = osc(0, 2, 10, 2, center=5)
    assert keys[0][1] == 5 and keys[-1][1] == 5
    assert max(v for _, v, _ in keys) == 15


def test_player_mixes_additive_and_fires_events_once():
    p = Player()
    assert p.play("si", now=100.0)
    base = Actions(tilt=5.0)
    out = p.apply(base, 100.15)  # en el primer cabeceo (-12)
    assert out.tilt == pytest.approx(5 - 12)
    assert base.tilt == 5.0, "no debe modificar las acciones del cerebro"
    p2 = Player()
    p2.play("cuac", 0.0)
    says = [p2.apply(Actions(), i * 0.05).say for i in range(30)]
    assert says.count("quack") == 1
    assert p2.apply(Actions(), 10.0) == Actions() and not p2.busy


def test_wheels_respect_lock():
    p = Player()
    p.play("susto", 0.0)
    out = p.apply(Actions(lock_wheels=True), 0.2)
    assert out.left == 0 and out.right == 0
    p.play("susto", 0.0)
    out = p.apply(Actions(), 0.2)
    assert out.left < 0 and out.right < 0


def test_priority_blocks_lower_animations():
    p = Player()
    p.play("susto", 0.0)
    assert not p.play("cuac", 0.1)
    assert p.play("susto", 0.2)


def test_mood_and_blink_events():
    p = Player({"x": Anim("x", {"tilt": [k(0, 0), k(1, 0)]}, [(0, "mood", "love"), (0.5, "blink", 1)])})
    p.play("x", 0.0)
    assert p.apply(Actions(), 0.0).mood == "love"
    out = p.apply(Actions(), 0.6)
    assert out.blink and out.mood == "love"


def test_preview_renders_frames():
    from pio.preview import render_animation

    frames = render_animation("cuac", fps=10, size=(150, 170))
    assert len(frames) >= 8 and frames[0].size == (150, 170)
