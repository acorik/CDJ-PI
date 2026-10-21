# Arquitectura

## Componentes

- **OBS Studio** (en el Pi): hace la composición de escenas y la codificación. Configúralo para usar el encoder hardware `h264_v4l2m2m` (Raspberry Pi 4/5), resolución de canvas reducida (p.ej. 1280x720) y FPS 30 para no saturar la CPU. obs-websocket (v5, integrado desde OBS 28) escucha solo en `127.0.0.1:4455`.
- **backend/** (Node + TypeScript): único servicio expuesto. Hace de proxy autenticado entre el frontend y OBS:
  - `src/obs/client.ts` mantiene la conexión persistente a obs-websocket y reexpone solo las operaciones necesarias (cambiar escena, mute/volumen, start/stop stream, status) — nunca pasa la contraseña de OBS al frontend.
  - `src/routes/*` — API REST para esas operaciones, protegida con JWT.
  - `src/ws/gateway.ts` — WebSocket autenticado que reenvía en tiempo real: cambios de escena, estado del stream (bitrate, frames perdidos, bytes enviados) y métricas del sistema (temperatura, throttling, carga).
  - `src/routes/system.ts` lee temperatura/throttling vía `vcgencmd measure_temp` / `vcgencmd get_throttled` y carga de `/proc/loadavg`.
- **frontend/** (React + Vite): panel responsive (pensado para usarse también desde el móvil mientras estás en la calle). Login, grid de escenas, mezclador de audio, controles de stream, panel de stats en vivo vía el WebSocket del backend.
- **deploy/**: Caddyfile (TLS automático), unidad systemd hardened para el backend, docker-compose opcional.

## Flujo de una acción (ej. cambiar de escena)

1. Usuario pulsa una escena en el frontend → `POST /scenes/:name/activate` con JWT en cookie.
2. Backend valida el JWT, aplica rate limit, llama a `obsClient.setCurrentScene(name)`.
3. obs-websocket cambia la escena en OBS.
4. OBS emite el evento `CurrentProgramSceneChanged` → el backend lo recibe y lo reenvía por el WS gateway a todos los clientes conectados (para que el móvil y el PC vean el cambio al instante, sin polling).

## Por qué no reimplementar OBS

Un compositor de vídeo en tiempo real (decodificación de fuentes, mezcla de capas, encoding) es un proyecto de años, no algo razonable para un Pi en este alcance, y OBS ya está optimizado para ese hardware. El valor real de este proyecto es la capa de control remoto segura que OBS no trae de fábrica.

## Segunda pieza: ChromeOS / Chromebooks de poca RAM

`chromeos-app/` es una app separada, sin backend propio, pensada para equipos donde ni correr OBS tiene sentido (Crostini se come demasiada RAM en un Chromebook de 4GB). Usa WHIP (WebRTC) para delegar la codificación al hardware del propio portátil y publica contra **MediaMTX** (`deploy/mediamtx/`), que reempaqueta sin recodificar hacia RTMP. Ver `docs/CHROMEOS_APP.md` para el detalle completo; no comparte código ni estado con el `backend/`/`frontend/` de control de OBS — son dos flujos de streaming independientes que pueden usarse a la vez o por separado.

## Roadmap (no implementado todavía)

- **Bonding de red para IRL** (failover automático WiFi/Ethernet/4G, estilo BELABOX/SRTLA): pensado como un módulo `backend/src/streaming/bonding.ts` que decida, según latencia/pérdida de cada interfaz, a qué conexión relay (SRT/RIST) reenvía OBS su salida. Requiere un relay externo (p.ej. `srtla_rec` en un VPS) — no se puede hacer solo con el Pi. Se documenta aquí como siguiente paso, no se reclama como implementado.
- **Overlays dinámicos** (chat, donaciones) servidos desde el propio backend como fuente de navegador en OBS.
- **Grabación local automática** de cada sesión con rotación de espacio en disco.
