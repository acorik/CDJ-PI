// Composición "a lo pobre" pero que de verdad funciona: en vez de dibujar
// cada fuente en un <canvas> (lo que rompe en cuanto una de ellas es un
// iframe de otro dominio, como VDO.Ninja — el canvas queda "contaminado"
// y no se puede leer ni exportar), colocamos cada fuente como una capa
// normal del DOM (vídeo de escritorio a pantalla completa, cámara/iframe
// como PiP, chat como texto) y al final auto-capturamos esta misma pestaña
// con getDisplayMedia. El propio compositor del navegador hace el trabajo
// de "mezclar" las capas — gratis, sin bucles de dibujo en JS.

export async function startDesktopCapture(videoEl: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 },
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play();
  return stream;
}

export async function startMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: false,
  });
}

export async function listVideoInputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput");
}

export async function startWebcam(videoEl: HTMLVideoElement, deviceId: string | undefined): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: deviceId ? { deviceId: { exact: deviceId } } : true,
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play();
  return stream;
}

export function randomStreamId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Devuelve el link que hay que abrir en el iPhone (Safari) para que mande su cámara. */
export function buildVdoNinjaPushLink(streamId: string): string {
  const params = new URLSearchParams({
    push: streamId,
    webcam: "",
    novideoselect: "", // va directo a pedir permiso de cámara, sin selector previo
    nopreview: "0",
  });
  return `https://vdo.ninja/?${params.toString()}`;
}

/** Monta el iframe receptor dentro de nuestra app para esa misma sala. */
export function setupVdoNinjaViewer(iframeEl: HTMLIFrameElement, streamId: string): void {
  const params = new URLSearchParams({
    view: streamId,
    cleanviewer: "", // sin controles/UI de VDO.Ninja superpuestos
    transparent: "",
    novideo: "0",
    noaudio: "0", // el audio del iPhone, si lo quieres, entra por aquí; el mic local sigue siendo aparte
  });
  iframeEl.src = `https://vdo.ninja/?${params.toString()}`;
  iframeEl.hidden = false;
}

/**
 * Auto-captura esta misma pestaña (ya con todas las capas montadas: vídeo
 * de escritorio, PiP de cámara/VDO.Ninja, chat) para producir el stream
 * final que se manda por WHIP. `preferCurrentTab` evita el selector
 * completo de pantallas y pide directamente compartir "esta pestaña".
 */
export async function captureComposedTab(): Promise<MediaStreamTrack> {
  const constraints: DisplayMediaStreamOptions & { preferCurrentTab?: boolean } = {
    video: { frameRate: 30 },
    audio: false,
    preferCurrentTab: true,
  };
  const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error("no se obtuvo vídeo al auto-capturar la pestaña");
  return track;
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}
