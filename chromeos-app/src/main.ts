import { startCompositor, type CompositorHandle } from "./capture";
import { publishWhip, type WhipSession } from "./whip";
import { startChatOverlay, type ChatOverlay } from "./chat";

const SETTINGS_KEY = "cdj-pi-chromeos-settings";

interface Settings {
  whipUrl: string;
  whipUser: string;
  whipPass: string;
  chatChannel: string;
  showCam: boolean;
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
const showCamInput = document.getElementById("showCam") as HTMLInputElement;
const startBtn = document.getElementById("startBtn") as HTMLButtonElement;
const stopBtn = document.getElementById("stopBtn") as HTMLButtonElement;
const statusDot = document.getElementById("statusDot") as HTMLSpanElement;
const statusText = document.getElementById("statusText") as HTMLSpanElement;
const bitrateEl = document.getElementById("bitrate") as HTMLSpanElement;
const canvas = document.getElementById("preview") as HTMLCanvasElement;
const desktopVideo = document.getElementById("desktopVideo") as HTMLVideoElement;
const camVideo = document.getElementById("camVideo") as HTMLVideoElement;

const saved = loadSettings();
if (saved.whipUrl) whipUrlInput.value = saved.whipUrl;
if (saved.whipUser) whipUserInput.value = saved.whipUser;
if (saved.chatChannel) chatChannelInput.value = saved.chatChannel;
if (typeof saved.showCam === "boolean") showCamInput.checked = saved.showCam;
// la contraseña NUNCA se autocompleta desde localStorage por defecto;
// si el usuario la guarda, queda en su navegador, no en ningún backend.
if (saved.whipPass) whipPassInput.value = saved.whipPass;

let compositor: CompositorHandle | null = null;
let whipSession: WhipSession | null = null;
let chatOverlay: ChatOverlay | null = null;
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
    showCam: showCamInput.checked,
  };
  saveSettings(settings);

  startBtn.disabled = true;
  setStatus("preparando captura...", false);

  try {
    if (settings.chatChannel) {
      chatOverlay = startChatOverlay(settings.chatChannel);
    }

    compositor = await startCompositor(canvas, desktopVideo, camVideo, settings.showCam, chatOverlay);

    setStatus("conectando...", false);
    const authHeader =
      settings.whipUser || settings.whipPass
        ? "Basic " + btoa(`${settings.whipUser}:${settings.whipPass}`)
        : undefined;

    whipSession = await publishWhip(settings.whipUrl, compositor.outputStream, authHeader);

    setStatus("EN DIRECTO", true);
    stopBtn.disabled = false;

    bitrateInterval = window.setInterval(() => reportBitrate(whipSession!.peerConnection), 3000);
  } catch (err) {
    setStatus(`error: ${(err as Error).message}`, false);
    startBtn.disabled = false;
    cleanup();
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
  if (compositor) {
    compositor.stop();
    compositor = null;
  }
  if (chatOverlay) {
    chatOverlay.stop();
    chatOverlay = null;
  }
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
