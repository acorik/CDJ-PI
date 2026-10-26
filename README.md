# CDJ-PI

Panel de control remoto, seguro, para una Raspberry Pi corriendo **OBS Studio** optimizado para directos IRL. Backend propio en medio de tu frontend y OBS: nunca expone la contraseña de obs-websocket ni el puerto de OBS a internet, añade su propia capa de autenticación, rate limiting y logging, y expone una API/WS mínima para controlar escenas, audio y el streaming desde cualquier otro PC o móvil.

## Por qué así y no "un OBS desde cero"

Reescribir un compositor de vídeo completo (decodificación, composición de escenas, encoder, RTMP/SRT) no tiene sentido en una Raspberry Pi: OBS ya hace eso con el encoder hardware del Pi (`h264_v4l2m2m`) de forma eficiente. Lo que de verdad falta, y es lo que construye este repo, es:

- Una app de control remoto **segura** (OBS-websocket por sí solo no tiene rate limiting, ni usuarios, ni HTTPS).
- Una capa pensada para IRL: estado de red, temperatura/throttling del Pi, reconexión de stream, todo accesible desde el móvil.
- Un despliegue hardened listo para producción en un Pi (systemd, reverse proxy TLS, firewall).

## Arquitectura

```
[Frontend React] <--HTTPS/WSS--> [Backend Node/TS] <--obs-websocket (localhost)--> [OBS Studio]
                                        |
                                        +--> vcgencmd / /sys (temp, throttling, red)
```

El backend es el **único** servicio expuesto (detrás de Caddy/nginx con TLS). OBS-websocket solo escucha en `localhost` dentro del Pi — nunca sale a internet. Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Estructura

- `backend/` — API REST + WebSocket (Express, TypeScript), autenticación JWT, cliente obs-websocket, métricas del sistema.
- `frontend/` — Panel de control (React + Vite + TS): login, escenas, mezclador de audio, controles de stream, stats en vivo.
- `droid/` — **Pío**, micro droide pato con VLM local en una Raspberry Pi 5: modelo 3D paramétrico (OpenSCAD + STL), lista de compra y cableado, y el software (reflejos + VLM). Ver [`droid/README.md`](droid/README.md).
- `chromeos-app/` — PWA ultraligera (sin dependencias) para ChromeOS/Chromebooks de poca RAM: captura desktop+mic+cámara y publica por WHIP. Ver `chromeos-app/README.md` y `docs/CHROMEOS_APP.md`.
- `deploy/` — unidades systemd hardened (backend y MediaMTX), Caddyfile con TLS automático, docker-compose, config de MediaMTX.
- `docs/` — guía de instalación en la Raspberry Pi, la app de ChromeOS, y notas de arquitectura.
- `SECURITY.md` — modelo de amenazas y checklist de seguridad (léelo antes de exponer nada a internet).

## Quick start (desarrollo local)

```bash
cp backend/.env.example backend/.env      # rellena los secretos, NUNCA los commitees
cp frontend/.env.example frontend/.env
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

Para desplegar en la Raspberry Pi real, sigue [docs/RPI_SETUP.md](docs/RPI_SETUP.md).

## Estado del proyecto

MVP funcional: auth, control de escenas/audio/stream vía obs-websocket, stats del sistema, despliegue hardened. El *bonding* de red para IRL (fallback 4G/WiFi automático tipo BELABOX) está documentado como roadmap en `docs/ARCHITECTURE.md` pero no implementado todavía — no se reclama como hecho.
