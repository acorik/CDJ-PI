"""Protecciones: actuadores ante datos basura, hombre muerto de las ruedas y privacidad."""
import json
import os
import stat
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import pytest

from pio.hardware import Servos, Wheels
from pio.vlm import VLMWorker, clean_caption, is_loopback_url, prune_diary

SERVOS = {"channels": {"pan": 0}, "limits": {"pan": [-60, 60]}, "trim": {"pan": 0}, "max_deg_per_s": 180}


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -float("inf")])
def test_wheels_never_turn_garbage_into_full_speed(bad):
    w = Wheels({"max_speed": 0.6}, sim=True)
    w.drive(bad, bad)
    assert w.speed == (0.0, 0.0)
    w.close()


def test_servo_ignores_nan_and_keeps_position():
    s = Servos(SERVOS, sim=True)
    s.update({"pan": 20}, 1.0)
    s.update({"pan": float("nan")}, 1.0)
    assert s.pos["pan"] == 20


def test_wheels_watchdog_stops_a_hung_loop():
    w = Wheels({"max_speed": 0.6, "watchdog_s": 0.2}, sim=True)
    w.drive(1, 1)
    assert w.speed != (0.0, 0.0)
    time.sleep(0.45)  # el bucle "se ha colgado"
    assert w.speed == (0.0, 0.0)
    w.close()


def test_real_motors_stop_with_mock_pins():
    gpiozero = pytest.importorskip("gpiozero")
    from gpiozero.pins.mock import MockFactory, MockPWMPin

    gpiozero.Device.pin_factory = MockFactory(pin_class=MockPWMPin)
    try:
        w = Wheels({"left": [12, 13], "right": [16, 26], "max_speed": 0.6, "watchdog_s": 0.2}, sim=False)
        w.drive(1, -1)
        assert w._l.value == pytest.approx(0.6) and w._r.value == pytest.approx(-0.6)
        time.sleep(0.45)
        assert w._l.value == 0 and w._r.value == 0
        w.close()
    finally:
        gpiozero.Device.pin_factory.reset()
        gpiozero.Device.pin_factory = None


def test_vlm_refuses_remote_urls_unless_allowed():
    assert is_loopback_url("http://127.0.0.1:8080/x") and is_loopback_url("http://localhost:8080/x")
    assert is_loopback_url("http://[::1]:8080/x")
    assert not is_loopback_url("http://192.168.1.20:8080/x")
    assert not is_loopback_url("http://127.0.0.1.evil.com/x")
    with pytest.raises(ValueError):
        VLMWorker("http://example.com/v1/chat/completions", "?")
    VLMWorker("http://192.168.1.20:8080/v1", "?", allow_remote=True)


def test_caption_is_cleaned():
    assert clean_caption("a cat\n\x1b[31mFAKE LOG LINE") == "a cat [31mFAKE LOG LINE"
    assert len(clean_caption("x" * 5000)) == 300


class _Handler(BaseHTTPRequestHandler):
    reply = b""
    status = 200
    location = None

    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        self.send_response(self.status)
        if self.location:
            self.send_header("Location", self.location)
        self.end_headers()
        self.wfile.write(self.reply)

    def log_message(self, *a):
        pass


@pytest.fixture
def server():
    srv = HTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv
    srv.shutdown()


def _url(srv):
    return f"http://127.0.0.1:{srv.server_address[1]}/v1/chat/completions"


def test_vlm_ignores_proxy_env_and_redirects(server, monkeypatch):
    monkeypatch.setenv("HTTP_PROXY", "http://10.255.255.1:3128")  # si se usara, la petición fallaría
    _Handler.status, _Handler.location = 200, None
    _Handler.reply = json.dumps({"choices": [{"message": {"content": "a duck"}}]}).encode()
    w = VLMWorker(_url(server), "?", timeout_s=3)
    frame = np.zeros((48, 64, 3), np.uint8)
    assert w.ask(frame) == "a duck"
    _Handler.status, _Handler.location = 307, "http://example.com/steal"
    with pytest.raises(Exception):
        w.ask(frame)


def test_vlm_rejects_huge_responses(server):
    _Handler.status, _Handler.location = 200, None
    _Handler.reply = b"x" * (300 * 1024)
    with pytest.raises(ValueError):
        VLMWorker(_url(server), "?", timeout_s=3).ask(np.zeros((48, 64, 3), np.uint8))


def test_diary_is_private_and_pruned(tmp_path):
    diary = tmp_path / "pio" / "diario.jsonl"
    w = VLMWorker("http://127.0.0.1:1/v1", "?", diary=str(diary), diary_days=7)
    w._write_diary(w.interpreter.interpret("a cat"))
    assert stat.S_IMODE(os.stat(diary).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(diary.parent).st_mode) == 0o700
    with diary.open("a") as f:
        f.write(json.dumps({"t": "2000-01-01 00:00:00", "caption": "viejo"}) + "\nbasura\n")
    prune_diary(diary, 7)
    lines = diary.read_text().splitlines()
    assert len(lines) == 1 and "cat" in lines[0]
    assert stat.S_IMODE(os.stat(diary).st_mode) == 0o600
