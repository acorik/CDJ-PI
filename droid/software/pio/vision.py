"""Reflejos visuales: cámara + detección de caras rápida (sin VLM).

YuNet (OpenCV) va a ~15-30 fps a 320x240 en la Pi 5. Si no está el modelo .onnx, se usa la
cascada Haar que trae OpenCV (peor, pero funciona sin descargar nada).
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

from .brain import Face

log = logging.getLogger(__name__)

YUNET = Path(__file__).resolve().parent.parent / "models" / "face_detection_yunet_2023mar.onnx"
DETECT_W, DETECT_H = 320, 240


class FaceDetector:
    def __init__(self, model: Path = YUNET):
        import cv2  # noqa: PLC0415

        self.cv2 = cv2
        self.yunet = self.haar = None
        if model.exists():
            self.yunet = cv2.FaceDetectorYN.create(str(model), "", (DETECT_W, DETECT_H), 0.7)
        elif hasattr(cv2, "CascadeClassifier"):  # OpenCV 4.x; en 5.x Haar ya no viene de serie
            log.warning("no encuentro %s; uso Haar (ejecuta scripts/setup_pi.sh)", model.name)
            self.haar = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        else:
            log.warning("sin detector de caras: descarga %s con scripts/setup_pi.sh", model.name)

    def detect(self, frame_bgr: np.ndarray) -> Face | None:
        small = self.cv2.resize(frame_bgr, (DETECT_W, DETECT_H))
        if self.yunet is not None:
            _, faces = self.yunet.detect(small)
            boxes = [] if faces is None else [f[:4] for f in faces]
        elif self.haar is not None:
            gray = self.cv2.cvtColor(small, self.cv2.COLOR_BGR2GRAY)
            boxes = self.haar.detectMultiScale(gray, 1.2, 5, minSize=(24, 24))
        else:
            return None
        if len(boxes) == 0:
            return None
        x, y, w, h = max(boxes, key=lambda b: b[2] * b[3])  # la cara más grande = la más cercana
        return Face(x=(x + w / 2) / DETECT_W * 2 - 1, y=(y + h / 2) / DETECT_H * 2 - 1, size=w / DETECT_W)
