"""Idioma de Pío: pitiditos de pato sintetizados al vuelo (sin TTS: barato y más mono).

Cada sonido es una lista de "sílabas" (frecuencia inicial, final, duración). Se generan con
numpy y se reproducen con sounddevice si está disponible; si no, el sonido se ignora.
"""
from __future__ import annotations

import logging
import random
import threading

import numpy as np

log = logging.getLogger(__name__)

Syllable = tuple[float, float, float]  # f0 Hz, f1 Hz, segundos

PHRASES: dict[str, list[Syllable]] = {
    "hello":    [(900, 1500, 0.08), (1500, 1300, 0.06), (1300, 1900, 0.12)],
    "happy":    [(1200, 1800, 0.07), (1400, 2000, 0.07), (1600, 2300, 0.10)],
    "curious":  [(700, 700, 0.06), (800, 1600, 0.18)],                    # entonación de pregunta
    "surprised": [(600, 2200, 0.14)],
    "sad":      [(1100, 700, 0.20), (800, 500, 0.25)],
    "annoyed":  [(400, 380, 0.08), (420, 360, 0.10)],
    "sleepy":   [(900, 500, 0.40)],
    "quack":    [(520, 450, 0.09), (560, 430, 0.12)],                     # cuac
}


def synth(syllables: list[Syllable], sr: int = 22050, rng: random.Random | None = None) -> np.ndarray:
    rng = rng or random.Random()
    out = []
    for f0, f1, dur in syllables:
        n = max(1, int(sr * dur * rng.uniform(0.9, 1.1)))
        jitter = rng.uniform(0.95, 1.05)
        f = np.geomspace(f0 * jitter, f1 * jitter, n)
        phase = 2 * np.pi * np.cumsum(f) / sr
        # onda "nasal" de pato: fundamental + armónicos impares
        wave = np.sin(phase) + 0.35 * np.sin(3 * phase) + 0.15 * np.sin(5 * phase)
        env = np.minimum(1.0, np.minimum(np.arange(n), np.arange(n)[::-1]) / (0.01 * sr))
        out.append(wave * env)
        out.append(np.zeros(int(sr * 0.03)))
    sig = np.concatenate(out)
    return (sig / (np.abs(sig).max() + 1e-9)).astype(np.float32)


class Voice:
    def __init__(self, enabled: bool = True, volume: float = 0.5, sample_rate: int = 22050):
        self.sr, self.volume = sample_rate, volume
        self._sd = None
        self._lock = threading.Lock()
        if enabled:
            try:
                import sounddevice as sd  # noqa: PLC0415
                self._sd = sd
            except Exception as e:  # sin audio: Pío se queda mudo, no pasa nada
                log.warning("audio desactivado: %s", e)

    def say(self, phrase: str) -> None:
        if self._sd is None or phrase not in PHRASES:
            return
        if not self._lock.acquire(blocking=False):
            return  # ya está hablando: no se pisa a sí mismo
        try:
            self._sd.play(synth(PHRASES[phrase], self.sr) * self.volume, self.sr)
            threading.Timer(sum(s[2] + 0.03 for s in PHRASES[phrase]) * 1.15, self._lock.release).start()
        except Exception as e:
            self._lock.release()
            log.warning("no he podido piar: %s", e)
