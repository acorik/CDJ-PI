import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient, type AudioSource, type Scene } from "../api/client";
import { useAuthStore } from "../store/auth";
import { SceneGrid } from "../components/SceneGrid";
import { AudioMixer } from "../components/AudioMixer";
import { StreamControls } from "../components/StreamControls";
import { StatsPanel } from "../components/StatsPanel";

interface StreamStatus {
  outputActive: boolean;
}

export function Dashboard() {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [audioSources, setAudioSources] = useState<AudioSource[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>({ outputActive: false });
  const [obsConnected, setObsConnected] = useState(false);
  const [stats, setStats] = useState({ temperatureC: null as number | null, throttled: false, loadavg: [0, 0, 0] });
  const navigate = useNavigate();
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated);
  const wsRef = useRef<WebSocket | null>(null);

  const refreshAll = useCallback(async () => {
    const [scenesRes, audioRes, streamRes, statsRes] = await Promise.all([
      apiClient.getScenes().catch(() => ({ data: { scenes: [] } })),
      apiClient.getAudioSources().catch(() => ({ data: { sources: [] } })),
      apiClient.getStreamStatus().catch(() => ({ data: { outputActive: false } })),
      apiClient.getSystemStats().catch(() => ({ data: { temperatureC: null, throttled: { throttled: false }, loadavg: [0, 0, 0] } })),
    ]);
    setScenes(scenesRes.data.scenes);
    setAudioSources(audioRes.data.sources);
    setStreamStatus(streamRes.data);
    setStats({
      temperatureC: statsRes.data.temperatureC,
      throttled: statsRes.data.throttled.throttled,
      loadavg: statsRes.data.loadavg,
    });
  }, []);

  useEffect(() => {
    void refreshAll();
    const interval = setInterval(() => void refreshAll(), 10000);

    const ws = new WebSocket(import.meta.env.VITE_WS_URL);
    wsRef.current = ws;
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "scene-changed") {
        setScenes((prev) => prev.map((s) => ({ ...s, active: s.name === msg.sceneName })));
      } else if (msg.type === "obs-connected") {
        setObsConnected(msg.connected);
      }
    };

    return () => {
      clearInterval(interval);
      ws.close();
    };
  }, [refreshAll]);

  async function handleLogout() {
    await apiClient.logout();
    setAuthenticated(false);
    navigate("/login");
  }

  return (
    <div className="dashboard">
      <header>
        <h1>CDJ-PI</h1>
        <button onClick={handleLogout}>Salir</button>
      </header>

      <StatsPanel {...stats} obsConnected={obsConnected} />

      <StreamControls
        streaming={streamStatus.outputActive}
        onStart={() => apiClient.startStream().then(refreshAll)}
        onStop={() => apiClient.stopStream().then(refreshAll)}
      />

      <section>
        <h2>Escenas</h2>
        <SceneGrid scenes={scenes} onActivate={(name) => apiClient.activateScene(name).then(refreshAll)} />
      </section>

      <section>
        <h2>Audio</h2>
        <AudioMixer
          sources={audioSources}
          onToggleMute={(name, muted) => apiClient.setMute(name, muted).then(refreshAll)}
          onVolumeChange={(name, volumeDb) => apiClient.setVolume(name, volumeDb).then(refreshAll)}
        />
      </section>
    </div>
  );
}
