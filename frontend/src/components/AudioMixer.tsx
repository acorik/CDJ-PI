import type { AudioSource } from "../api/client";

interface Props {
  sources: AudioSource[];
  onToggleMute: (name: string, muted: boolean) => void;
  onVolumeChange: (name: string, volumeDb: number) => void;
}

export function AudioMixer({ sources, onToggleMute, onVolumeChange }: Props) {
  if (sources.length === 0) {
    return <p className="muted">Sin fuentes de audio</p>;
  }
  return (
    <div className="audio-mixer">
      {sources.map((source) => (
        <div key={source.name} className="audio-channel">
          <span>{source.name}</span>
          <input
            type="range"
            min={-60}
            max={6}
            step={1}
            value={source.volumeDb}
            onChange={(e) => onVolumeChange(source.name, Number(e.target.value))}
          />
          <button onClick={() => onToggleMute(source.name, !source.muted)}>
            {source.muted ? "Unmute" : "Mute"}
          </button>
        </div>
      ))}
    </div>
  );
}
