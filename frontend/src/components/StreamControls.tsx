interface Props {
  streaming: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function StreamControls({ streaming, onStart, onStop }: Props) {
  return (
    <div className="stream-controls">
      <span className={streaming ? "status live" : "status"}>{streaming ? "EN DIRECTO" : "parado"}</span>
      {streaming ? (
        <button className="danger" onClick={onStop}>
          Detener stream
        </button>
      ) : (
        <button className="primary" onClick={onStart}>
          Iniciar stream
        </button>
      )}
    </div>
  );
}
