// Captura desktop + mic + cámara y las compone en un <canvas>.
// Deliberadamente simple: nada de WebGL ni efectos, para no gastar CPU/RAM
// en un Chromebook de 4GB. El propio encoder de WebRTC (hardware, vía
// chrome://media-internals) es quien hace el trabajo pesado, no este código.

import type { ChatOverlay } from "./chat";

export interface CompositorHandle {
  outputStream: MediaStream;
  stop: () => void;
}

const CANVAS_FPS = 30;
const CAM_WIDTH_RATIO = 0.22;

export async function startCompositor(
  canvas: HTMLCanvasElement,
  desktopVideo: HTMLVideoElement,
  camVideo: HTMLVideoElement,
  showCam: boolean,
  chatOverlay: ChatOverlay | null,
): Promise<CompositorHandle> {
  const desktopStream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: CANVAS_FPS },
    audio: false,
  });

  const micCamStream = await navigator.mediaDevices.getUserMedia({
    video: showCam ? { width: 320, height: 240, frameRate: 30 } : false,
    audio: { echoCancellation: true, noiseSuppression: true },
  });

  desktopVideo.srcObject = desktopStream;
  await desktopVideo.play();

  if (showCam) {
    camVideo.srcObject = micCamStream;
    await camVideo.play();
  }

  const ctx = canvas.getContext("2d", { alpha: false })!;
  let running = true;

  function draw() {
    if (!running) return;
    const w = canvas.width;
    const h = canvas.height;

    if (desktopVideo.readyState >= 2) {
      ctx.drawImage(desktopVideo, 0, 0, w, h);
    }

    if (showCam && camVideo.readyState >= 2) {
      const camW = w * CAM_WIDTH_RATIO;
      const camH = (camW * camVideo.videoHeight) / camVideo.videoWidth;
      const x = w - camW - 16;
      const y = h - camH - 16;
      ctx.save();
      ctx.strokeStyle = "#2d6cdf";
      ctx.lineWidth = 3;
      ctx.strokeRect(x - 2, y - 2, camW + 4, camH + 4);
      ctx.drawImage(camVideo, x, y, camW, camH);
      ctx.restore();
    }

    chatOverlay?.drawOnto(ctx, w, h);

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  const canvasStream = canvas.captureStream(CANVAS_FPS);
  const audioTrack = micCamStream.getAudioTracks()[0];
  if (audioTrack) canvasStream.addTrack(audioTrack);

  // si el usuario comparte audio del sistema al elegir la pestaña/ventana,
  // también se mezcla (poco frecuente en IRL, pero gratis si está disponible)
  const systemAudioTrack = desktopStream.getAudioTracks()[0];
  if (systemAudioTrack) canvasStream.addTrack(systemAudioTrack);

  return {
    outputStream: canvasStream,
    stop: () => {
      running = false;
      desktopStream.getTracks().forEach((t) => t.stop());
      micCamStream.getTracks().forEach((t) => t.stop());
      canvasStream.getTracks().forEach((t) => t.stop());
    },
  };
}
