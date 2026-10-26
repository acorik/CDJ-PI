import random

from pio.brain import Brain, Face, Percepts
from pio.vlm import Interpreter, Observation


def run(brain, t0, seconds, **kw):
    act = None
    t = t0
    while t < t0 + seconds:
        act = brain.step(Percepts(t=t, **kw))
        t += 0.05
    return act, t


def test_greets_and_tracks_a_face():
    b = Brain(rng=random.Random(1))
    act = b.step(Percepts(t=1.0, face=Face(x=0.5, y=0.0, size=0.2)))
    assert b.state == "TRACK"
    assert act.play == "hola" and act.mood == "happy"
    act, _ = run(b, 1.05, 2.0, face=Face(x=0.5, y=0.0, size=0.2))
    assert act.pan < -5, "el cuello debe girar hacia la cara (derecha de la imagen = pan negativo)"


def test_goes_idle_after_losing_the_face():
    b = Brain(rng=random.Random(1))
    run(b, 0.0, 1.0, face=Face(0, 0, 0.2))
    run(b, 1.0, 3.5)
    assert b.state == "IDLE"


def test_lifted_is_top_priority_and_wheels_stop():
    b = Brain(rng=random.Random(1))
    act = b.step(Percepts(t=0.0, cliff_left=True, cliff_right=True, face=Face(0, 0, 0.2)))
    assert b.state == "LIFTED" and act.play == "susto"
    assert act.left == act.right == 0 and act.lock_wheels
    act = b.step(Percepts(t=0.1))
    assert b.state == "IDLE" and act.play == "feliz"


def test_one_cliff_triggers_backoff_reflex():
    b = Brain(rng=random.Random(1))
    act = b.step(Percepts(t=0.0, cliff_left=True))
    assert act.left < 0 and act.right < 0, "retrocede"
    assert act.left > act.right, "y gira alejándose del borde izquierdo"


def test_falls_asleep_when_tired_and_wakes_for_a_friend():
    b = Brain(rng=random.Random(1), energy=0.1)
    act = b.step(Percepts(t=0.0))
    assert b.state == "SLEEP" and act.mood == "sleepy" and act.play == "dormirse"
    b.energy = 0.5
    act = b.step(Percepts(t=0.1, face=Face(0, 0, 0.2)))
    assert b.state == "TRACK" and act.play == "despertar"


def test_interesting_observation_makes_it_curious():
    b = Brain(rng=random.Random(1))
    obs = Observation("a cat on a sofa", "animal", "surprised", 0.9, 1.0, 3.0)
    act = b.step(Percepts(t=0.0, observation=obs))
    assert b.state == "CURIOUS" and act.mood == "surprised" and act.play == "eh"
    run(b, 0.05, 4.2)
    assert b.state == "IDLE"


def test_requests_vlm_periodically():
    b = Brain(rng=random.Random(1), vlm_every_s=10)
    assert b.step(Percepts(t=0.0)).want_vlm
    b.vlm_sent(0.0)
    assert not b.step(Percepts(t=5.0)).want_vlm
    assert b.step(Percepts(t=10.5)).want_vlm


def test_interpreter_novelty_drops_with_repetition():
    it = Interpreter()
    first = it.interpret("A cat sitting on a red sofa.")
    again = it.interpret("A cat sitting on a red sofa.")
    assert first.topic == "animal" and first.novelty == 1.0
    assert again.novelty == 0.0 and again.interest < first.interest
    assert it.interpret("A dark room, nothing visible.").topic == "dark"


def test_close_face_gets_love_with_cooldown():
    b = Brain(rng=random.Random(1))
    b.step(Percepts(t=0.0, face=Face(0, 0, 0.2)))
    act = b.step(Percepts(t=0.1, face=Face(0, 0, 0.5)))
    assert act.play == "amor" and act.blush
    act = b.step(Percepts(t=5.0, face=Face(0, 0, 0.5)))
    assert act.play is None


def test_idle_plays_a_gesture_now_and_then():
    b = Brain(rng=random.Random(3))
    played = set()
    t = 0.0
    while t < 200:
        act = b.step(Percepts(t=t))
        if act.play:
            played.add(act.play)
        t += 0.05
    assert played, "en 200 s de reposo debería hacer algún gesto"
