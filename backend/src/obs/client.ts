import OBSWebSocket from "obs-websocket-js";
import { EventEmitter } from "node:events";
import { config } from "../config";
import { logger } from "../utils/logger";

export interface SceneInfo {
  name: string;
  active: boolean;
}

class ObsClient extends EventEmitter {
  private obs = new OBSWebSocket();
  private connected = false;
  private connecting: Promise<void> | null = null;

  constructor() {
    super();
    this.obs.on("ConnectionClosed", () => {
      this.connected = false;
      logger.warn("obs-websocket: conexión cerrada, reintentando en 5s");
      setTimeout(() => void this.connect(), 5000);
    });
    this.obs.on("CurrentProgramSceneChanged", (data) => {
      this.emit("scene-changed", data.sceneName);
    });
    this.obs.on("StreamStateChanged", (data) => {
      this.emit("stream-state", data);
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      try {
        await this.obs.connect(config.OBS_WS_URL, config.OBS_WS_PASSWORD || undefined);
        this.connected = true;
        logger.info("Conectado a obs-websocket");
      } catch (err) {
        logger.error("No se pudo conectar a obs-websocket", { message: (err as Error).message });
        throw err;
      } finally {
        this.connecting = null;
      }
    })();

    return this.connecting;
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new Error("OBS no está conectado");
    }
  }

  async listScenes(): Promise<SceneInfo[]> {
    this.assertConnected();
    const { scenes, currentProgramSceneName } = await this.obs.call("GetSceneList");
    return scenes
      .map((s) => ({ name: String(s.sceneName), active: s.sceneName === currentProgramSceneName }))
      .reverse();
  }

  async setCurrentScene(name: string): Promise<void> {
    this.assertConnected();
    await this.obs.call("SetCurrentProgramScene", { sceneName: name });
  }

  async listAudioSources(): Promise<Array<{ name: string; muted: boolean; volumeDb: number }>> {
    this.assertConnected();
    const { inputs } = await this.obs.call("GetInputList");
    const results = [];
    for (const input of inputs) {
      const name = String(input.inputName);
      try {
        const [muteState, volumeState] = await Promise.all([
          this.obs.call("GetInputMute", { inputName: name }),
          this.obs.call("GetInputVolume", { inputName: name }),
        ]);
        results.push({ name, muted: muteState.inputMuted, volumeDb: volumeState.inputVolumeDb });
      } catch {
        // la fuente no soporta audio (ej. una imagen) — se omite
      }
    }
    return results;
  }

  async setMute(name: string, muted: boolean): Promise<void> {
    this.assertConnected();
    await this.obs.call("SetInputMute", { inputName: name, inputMuted: muted });
  }

  async setVolumeDb(name: string, volumeDb: number): Promise<void> {
    this.assertConnected();
    await this.obs.call("SetInputVolume", { inputName: name, inputVolumeDb: volumeDb });
  }

  async startStream(): Promise<void> {
    this.assertConnected();
    await this.obs.call("StartStream");
  }

  async stopStream(): Promise<void> {
    this.assertConnected();
    await this.obs.call("StopStream");
  }

  async getStreamStatus() {
    this.assertConnected();
    return this.obs.call("GetStreamStatus");
  }

  isConnected(): boolean {
    return this.connected;
  }
}

export const obsClient = new ObsClient();
