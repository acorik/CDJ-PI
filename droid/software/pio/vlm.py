"""Cerebro lento: pregunta a una VLM local (llama.cpp `llama-server`) qué está viendo.

La VLM tarda segundos en la Pi 5, así que corre en un hilo aparte y nunca bloquea el bucle
de control. Su respuesta (una frase) se traduce a algo que el comportamiento entiende:
tema, ánimo sugerido e interés (que sube cuando la escena es *nueva* para Pío).
"""
from __future__ import annotations

import base64
import io
import ipaddress
import json
import logging
import os
import queue
import re
import threading
import time
import urllib.parse
import urllib.request
from collections import deque
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

log = logging.getLogger(__name__)

# (palabras clave, tema, ánimo, interés base). Las VLM pequeñas responden mejor en inglés.
TOPICS: list[tuple[tuple[str, ...], str, str, float]] = [
    (("cat", "dog", "puppy", "kitten", "pet", "bird", "duck", "animal"), "animal", "surprised", 0.9),
    (("toy", "ball", "robot", "lego", "doll", "teddy"), "toy", "curious", 0.8),
    (("cake", "pizza", "fruit", "apple", "banana", "cookie", "bread", "food", "coffee", "cup"), "food", "happy", 0.7),
    (("person", "man", "woman", "child", "boy", "girl", "people", "face", "hand", "smiling"), "person", "happy", 0.6),
    (("plant", "flower", "tree", "garden"), "plant", "curious", 0.5),
    (("computer", "laptop", "screen", "phone", "keyboard", "monitor", "book"), "tech", "curious", 0.4),
    (("dark", "black", "nothing", "blurry", "blank"), "dark", "sleepy", 0.1),
]
MAX_RESPONSE_BYTES = 256 * 1024
MAX_CAPTION_CHARS = 300

STOP = {"a", "an", "the", "of", "in", "on", "with", "and", "is", "are", "there", "this", "image", "picture", "shows", "to", "it", "its"}


@dataclass
class Observation:
    caption: str
    topic: str
    mood: str
    interest: float   # 0..1
    novelty: float    # 0..1
    latency_s: float


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]+", text.lower()) if w not in STOP}


class Interpreter:
    """Convierte frases en emociones. Recuerda lo último que vio para medir la novedad."""

    def __init__(self, memory: int = 12):
        self.recent: deque[set[str]] = deque(maxlen=memory)

    def interpret(self, caption: str, latency_s: float = 0.0) -> Observation:
        words = _words(caption)
        topic, mood, base = "other", "neutral", 0.3
        for keys, t, m, b in TOPICS:
            if words & set(keys):
                topic, mood, base = t, m, b
                break
        sims = [len(words & r) / max(1, len(words | r)) for r in self.recent]
        novelty = 1.0 - max(sims, default=0.0)
        self.recent.append(words)
        interest = round(0.5 * base + 0.5 * base * novelty + 0.2 * novelty, 3)
        return Observation(caption.strip(), topic, mood, min(1.0, interest), round(novelty, 3), latency_s)


def encode_jpeg(frame_bgr: np.ndarray, width: int) -> str:
    img = Image.fromarray(np.ascontiguousarray(frame_bgr[..., ::-1]))
    if img.width > width:
        img = img.resize((width, round(img.height * width / img.width)))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def is_loopback_url(url: str) -> bool:
    host = urllib.parse.urlsplit(url).hostname or ""
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def clean_caption(text: str) -> str:
    """La respuesta de la VLM es un dato, no una orden: se recorta y se le quitan los controles."""
    text = re.sub(r"[\x00-\x1f\x7f]+", " ", str(text))
    return text.strip()[:MAX_CAPTION_CHARS]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: D102 - una redirección podría sacar la foto fuera
        return None


# Sin proxies (urllib respeta HTTP_PROXY incluso para 127.0.0.1) y sin redirecciones:
# las fotos de tu casa van directas al servidor local y a ningún otro sitio.
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())


def prune_diary(path: Path, days: float) -> None:
    """Borra del diario las entradas con más de `days` días."""
    if days <= 0 or not path.exists():
        return
    cutoff = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time() - days * 86400))
    keep = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            try:
                if json.loads(line)["t"] >= cutoff:
                    keep.append(line)
            except (ValueError, KeyError):
                continue  # línea rota: fuera
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.writelines(keep)
    os.replace(tmp, path)


class VLMWorker:
    def __init__(self, url: str, prompt: str, max_tokens: int = 48, timeout_s: float = 60.0,
                 jpeg_width: int = 384, diary: str | None = None, diary_days: float = 7,
                 allow_remote: bool = False):
        if not is_loopback_url(url) and not allow_remote:
            raise ValueError(f"vlm.url={url!r} no es local: las fotos saldrían de la Pi. "
                             "Si de verdad lo quieres (p. ej. un PC tuyo con GPU), pon vlm.allow_remote: true")
        if not is_loopback_url(url):
            log.warning("la VLM es remota (%s): las fotos viajan por la red", url)
        self.url, self.prompt, self.max_tokens = url, prompt, max_tokens
        self.timeout_s, self.jpeg_width = timeout_s, jpeg_width
        self.diary = Path(diary).expanduser() if diary else None
        self.diary_days = diary_days
        self._last_prune = 0.0
        self.interpreter = Interpreter()
        self._results: queue.Queue[Observation] = queue.Queue()
        self._busy = threading.Event()

    @property
    def busy(self) -> bool:
        return self._busy.is_set()

    def request(self, frame_bgr: np.ndarray) -> bool:
        """Lanza una consulta si no hay otra en curso. Devuelve True si se lanzó."""
        if self.busy or frame_bgr is None:
            return False
        self._busy.set()
        threading.Thread(target=self._run, args=(frame_bgr.copy(),), daemon=True).start()
        return True

    def poll(self) -> Observation | None:
        try:
            return self._results.get_nowait()
        except queue.Empty:
            return None

    def _run(self, frame: np.ndarray) -> None:
        t0 = time.monotonic()
        try:
            caption = clean_caption(self.ask(frame))
            obs = self.interpreter.interpret(caption, time.monotonic() - t0)
            log.info("VLM (%.1fs): %s -> %s/%s interés=%.2f", obs.latency_s, obs.caption, obs.topic, obs.mood, obs.interest)
            self._write_diary(obs)
            self._results.put(obs)
        except Exception as e:
            log.warning("la VLM no responde (%s); sigo con los reflejos", e)
        finally:
            self._busy.clear()

    def ask(self, frame: np.ndarray) -> str:
        body = {
            "messages": [{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + encode_jpeg(frame, self.jpeg_width)}},
                {"type": "text", "text": self.prompt},
            ]}],
            "max_tokens": self.max_tokens,
            "temperature": 0.2,
        }
        req = urllib.request.Request(self.url, json.dumps(body).encode(), {"Content-Type": "application/json"})
        with _OPENER.open(req, timeout=self.timeout_s) as r:
            raw = r.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError("respuesta de la VLM demasiado grande")
        return str(json.loads(raw)["choices"][0]["message"]["content"])

    def _write_diary(self, obs: Observation) -> None:
        # el "diario" de Pío: lo que ha visto hoy, para leerlo juntos luego
        # (describe tu casa: solo lo lee tu usuario y se borra pasados `diary_days` días)
        if not self.diary:
            return
        self.diary.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if time.monotonic() - self._last_prune > 3600:
            prune_diary(self.diary, self.diary_days)
            self._last_prune = time.monotonic()
        fd = os.open(self.diary, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "a", encoding="utf-8") as f:
            f.write(json.dumps({"t": time.strftime("%Y-%m-%d %H:%M:%S"), **obs.__dict__}, ensure_ascii=False) + "\n")
