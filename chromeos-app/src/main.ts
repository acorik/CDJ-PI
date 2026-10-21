import {
  startDesktopCapture,
  startMic,
  startWebcam,
  listVideoInputDevices,
  randomStreamId,
  buildVdoNinjaPushLink,
  setupVdoNinjaViewer,
  captureComposedTab,
  stopStream,
} from "./capture";
import { publishWhip, type WhipSession } from "./whip";
import { startChatOverlay, type ChatHandle } from "./chat";

const SETTINGS_KEY = "cdj-pi-chromeos-settings";

type CameraSource = "none" | "webcam" | "vdoninja";

interface Settings {
  whipUrl: string;
  whipUser: string;
  whipPass: string;
  chatChannel: string;
  cameraSource: CameraSource;
  webcamDeviceId: string;
  vdoStreamId: string;
}

function loadSettings(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveSettings(settings: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

const form = document.getElementById("settings") as HTMLFormElement;
const whipUrlInput = document.getElementById("whipUrl") as HTMLInputElement;
const whipUserInput = document.getElementById("whipUser") as HTMLInputElement;
const whipPassInput = document.getElementById("whipPass") as HTMLInputElement;
const chatChannelInput = document.getElementById("chatChannel") as HTMLInputElement;
const cameraSourceSelect = document.getElementById("cameraSource") as HTMLSelectElement;
const webcamDeviceRow = document.getElementById("webcamDeviceRow") as HTMLLabelElement;
const webcamDeviceSelect = document.getElementById("webcamDevice") as HTMLSelectElement;
const vdoRow = document.getElementById("vdoRow") as HTMLLabelElement;
const vdoStreamIdInput = document.getElementById("vdoStreamId") as HTMLInputElement;
const vdoLinkEl = document.getElementById("vdoLink") as HTMLParagraphElement;
const startBtn = document.getElementById("startBtn") as HTMLButtonElement;
const stopBtn = document.getElementById("stopBtn") as HTMLButtonElement;
const statusDot = document.getElementById("statusDot") as HTMLSpanElement;
const statusText = document.getElementById("statusText") as HTMLSpanElement;
const bitrateEl = document.getElementById("bitrate") as HTMLSpanElement;
const desktopVideo = document.getElementById("desktopVideo") as HTMLVideoElement;
const camVideo = document.getElementById("camVideo") as HTMLVideoElement;
const vdoFrame = document.getElementById("vdoFrame") as HTMLIFrameElement;
const chatBox = document.getElementById("chatBox") as HTMLDivElement;

const saved = loadSettings();
if (saved.whipUrl) whipUrlInput.value = saved.whipUrl;
if (saved.whipUser) whipUserInput.value = saved.whipUser;
if (saved.whipPass) whipPassInput.value = saved.whipPass; // ver README: trade-off asumido
if (saved.chatChannel) chatChannelInput.value = saved.chatChannel;
if (saved.cameraSource) cameraSourceSelect.value = saved.cameraSource;
if (saved.vdoStreamId) vdoStreamIdInput.value = saved.vdoStreamId;

function updateCameraSourceUI() {
  const source = cameraSourceSelect.value as CameraSource;
  webcamDeviceRow.hidden = source !== "webcam";
  vdoRow.hidden = source !== "vdoninja";
  vdoLinkEl.hidden = source !== "vdoninja";
}
cameraSourceSelect.addEventListener("change", updateCameraSourceUI);
updateCameraSourceUI();

async function refreshWebcamList() {
  try {
    const devices = await listVideoInputDevices();
    webcamDeviceSelect.innerHTML = "";
    devices.forEach((d, i) => {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || `Cámara ${i + 1}`;
      webcamDeviceSelect.appendChild(opt);
    });
  } catch {
    // sin permiso todavía: se rellenará tras el primer getUserMedia
  }
}
void refreshWebcamList();
navigator.mediaDevices.addEventListener?.("devicechange", refreshWebcamList);

let desktopStream: MediaStream | null = null;
let webcamStream: MediaStream | null = null;
let micStream: MediaStream | null = null;
let composedTrack: MediaStreamTrack | null = null;
let chatHandle: ChatHandle | null = null;
let whipSession: WhipSession | null = null;
let bitrateInterval: number | null = null;

function setStatus(text: string, live: boolean) {
  statusText.textContent = text;
  statusDot.classList.toggle("live", live);
}

async function start() {
  const settings: Settings = {
    whipUrl: whipUrlInput.value.trim(),
    whipUser: whipUserInput.value.trim(),
    whipPass: whipPassInput.value,
    chatChannel: chatChannelInput.value.trim(),
    cameraSource: cameraSourceSelect.value as CameraSource,
    webcamDeviceId: webcamDeviceSelect.value,
    vdoStreamId: vdoStreamIdInput.value.trim(),
  };
  saveSettings(settings);

  startBtn.disabled = true;

  try {
    setStatus("compartiendo escritorio/juego...", false);
    desktopStream = await startDesktopCapture(desktopVideo);

    if (settings.cameraSource === "webcam") {
      setStatus("pidiendo cámara...", false);
      webcamStream = await startWebcam(camVideo, settings.webcamDeviceId || undefined);
      camVideo.hidden = false;
      await refreshWebcamList(); // ahora ya hay permiso: salen las etiquetas reales
    } else if (settings.cameraSource === "vdoninja") {
      const streamId = settings.vdoStreamId || randomStreamId();
      vdoStreamIdInput.value = streamId;
      const pushLink = buildVdoNinjaPushLink(streamId);
      vdoLinkEl.hidden = false;
      vdoLinkEl.textContent = `En el iPhone (Safari), abre: ${pushLink}`;
      setupVdoNinjaViewer(vdoFrame, streamId);
    }

    if (settings.chatChannel) {
      chatHandle = startChatOverlay(settings.chatChannel, chatBox);
    }

    setStatus("pidiendo micrófono...", false);
    micStream = await startMic();

    setStatus("elige 'Esta pestaña' al compartir (último paso)...", false);
    // pequeño respiro para que el navegador pinte ya las capas (cámara/VDO.Ninja/chat)
    // antes de auto-capturar la pestaña, si no, la primera captura puede salir en blanco
    await new Promise((r) => setTimeout(r, 400));
    composedTrack = await captureComposedTab();

    const outputStream = new MediaStream([composedTrack, ...micStream.getAudioTracks()]);

    setStatus("conectando al relay...", false);
    const authHeader =
      settings.whipUser || settings.whipPass
        ? "Basic " + btoa(`${settings.whipUser}:${settings.whipPass}`)
        : undefined;
    whipSession = await publishWhip(settings.whipUrl, outputStream, authHeader);

    setStatus("EN DIRECTO", true);
    stopBtn.disabled = false;
    bitrateInterval = window.setInterval(() => reportBitrate(whipSession!.peerConnection), 3000);
  } catch (err) {
    setStatus(`error: ${(err as Error).message}`, false);
    startBtn.disabled = false;
    await cleanup();
  }
}

let lastBytes = 0;
let lastTimestamp = 0;

async function reportBitrate(pc: RTCPeerConnection) {
  const stats = await pc.getStats();
  stats.forEach((report) => {
    if (report.type === "outbound-rtp" && report.kind === "video") {
      const bytes = report.bytesSent as number;
      const timestamp = report.timestamp as number;
      if (lastTimestamp > 0) {
        const kbps = (((bytes - lastBytes) * 8) / (timestamp - lastTimestamp)).toFixed(0);
        bitrateEl.textContent = `· ${kbps} kbps`;
      }
      lastBytes = bytes;
      lastTimestamp = timestamp;
    }
  });
}

async function stop() {
  stopBtn.disabled = true;
  setStatus("parando...", false);
  await cleanup();
  setStatus("parado", false);
  startBtn.disabled = false;
}

async function cleanup() {
  if (bitrateInterval) window.clearInterval(bitrateInterval);
  bitrateInterval = null;
  lastBytes = 0;
  lastTimestamp = 0;
  bitrateEl.textContent = "";

  if (whipSession) {
    await whipSession.stop().catch(() => undefined);
    whipSession = null;
  }
  composedTrack?.stop();
  composedTrack = null;
  stopStream(desktopStream);
  desktopStream = null;
  stopStream(webcamStream);
  webcamStream = null;
  stopStream(micStream);
  micStream = null;
  camVideo.hidden = true;
  vdoFrame.hidden = true;
  vdoFrame.src = "";
  chatHandle?.stop();
  chatHandle = null;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  void start();
});
stopBtn.addEventListener("click", () => void stop());

window.addEventListener("beforeunload", () => {
  void cleanup();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => undefined);
}
