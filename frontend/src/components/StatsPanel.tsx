interface Props {
  temperatureC: number | null;
  throttled: boolean;
  loadavg: number[];
  obsConnected: boolean;
}

export function StatsPanel({ temperatureC, throttled, loadavg, obsConnected }: Props) {
  return (
    <div className="stats-panel">
      <div>
        <span className="label">OBS</span>
        <span className={obsConnected ? "ok" : "bad"}>{obsConnected ? "conectado" : "desconectado"}</span>
      </div>
      <div>
        <span className="label">Temp</span>
        <span className={throttled ? "bad" : "ok"}>{temperatureC !== null ? `${temperatureC.toFixed(1)}°C` : "n/d"}</span>
      </div>
      <div>
        <span className="label">Throttling</span>
        <span className={throttled ? "bad" : "ok"}>{throttled ? "sí" : "no"}</span>
      </div>
      <div>
        <span className="label">Carga</span>
        <span>{loadavg.map((v) => v.toFixed(2)).join(" / ")}</span>
      </div>
    </div>
  );
}
