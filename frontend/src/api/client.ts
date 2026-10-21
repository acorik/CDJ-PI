import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
});

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      try {
        await api.post("/auth/refresh");
        return api.request(error.config);
      } catch {
        onUnauthorized?.();
      }
    }
    return Promise.reject(error);
  },
);

export interface Scene {
  name: string;
  active: boolean;
}

export interface AudioSource {
  name: string;
  muted: boolean;
  volumeDb: number;
}

export const apiClient = {
  login: (username: string, password: string) => api.post("/auth/login", { username, password }),
  logout: () => api.post("/auth/logout"),
  getScenes: () => api.get<{ scenes: Scene[] }>("/scenes"),
  activateScene: (name: string) => api.post(`/scenes/${encodeURIComponent(name)}/activate`),
  getStreamStatus: () => api.get("/stream/status"),
  startStream: () => api.post("/stream/start"),
  stopStream: () => api.post("/stream/stop"),
  getAudioSources: () => api.get<{ sources: AudioSource[] }>("/audio/sources"),
  setMute: (source: string, muted: boolean) => api.post(`/audio/${encodeURIComponent(source)}/mute`, { muted }),
  setVolume: (source: string, volumeDb: number) =>
    api.post(`/audio/${encodeURIComponent(source)}/volume`, { volumeDb }),
  getSystemStats: () =>
    api.get<{ temperatureC: number | null; throttled: { throttled: boolean }; loadavg: number[] }>("/system/stats"),
};
