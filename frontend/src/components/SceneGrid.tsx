import type { Scene } from "../api/client";

interface Props {
  scenes: Scene[];
  onActivate: (name: string) => void;
}

export function SceneGrid({ scenes, onActivate }: Props) {
  if (scenes.length === 0) {
    return <p className="muted">Sin escenas (¿OBS conectado?)</p>;
  }
  return (
    <div className="scene-grid">
      {scenes.map((scene) => (
        <button
          key={scene.name}
          className={scene.active ? "scene active" : "scene"}
          onClick={() => onActivate(scene.name)}
        >
          {scene.name}
        </button>
      ))}
    </div>
  );
}
