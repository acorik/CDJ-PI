# CDJ-PI IRL para ChromeOS / Chromebooks de 4GB

## Por qué esto y no la app de escritorio

En un Chromebook de 4GB, OBS Studio (que necesita Linux/Crostini) se come demasiada RAM solo para arrancar. La alternativa que de verdad rinde en ese hardware es quedarse en el navegador y dejar que el encoder hardware haga el trabajo, igual que hace Google Meet. Por eso `chromeos-app/` es:

- Sin frameworks, sin dependencias en runtime (bundle de ~6KB).
- Captura desktop + mic + cámara con las APIs nativas del navegador.
- Composición en un único `<canvas>` (cámara en una esquina, chat opcional).
- Publicación por **WHIP** (WebRTC), hardware-encoded, directo a tu propio relay.

No lleva autenticación propia tipo backend (a diferencia de `backend/`): es una app estática, sin servidor, pensada para ejecutarse offline-first en el propio Chromebook. La única pieza de servidor que necesita es el relay WHIP→RTMP.

## Arquitectura

```
[Chrome en el Chromebook]
  getDisplayMedia + getUserMedia -> <canvas> -> WHIP (WebRTC)
        |
        v   (HTTPS, puerto 443 vía Caddy; UDP ICE directo)
[MediaMTX en la Raspberry Pi]
        |  runOnReady: ffmpeg -c copy (sin recodificar)
        v
[RTMP de Twitch / Kick / YouTube / lo que sea]
```

MediaMTX puede vivir en la misma Pi que ya tienes corriendo el backend de OBS (son dos servicios independientes, `cdj-backend` y `mediamtx`) o en una VPS si prefieres no depender de la subida de tu Pi para el relay.

## Despliegue del relay (en la Raspberry Pi)

```bash
# 1. Descargar el binario arm64 desde https://github.com/bluenviron/mediamtx/releases
sudo mkdir -p /opt/mediamtx
sudo tar -xzf mediamtx_*_linux_arm64.tar.gz -C /opt/mediamtx
sudo useradd --system --no-create-home mediamtx

# 2. Configurar (NUNCA commitees esta copia con tus credenciales reales)
sudo cp deploy/mediamtx/mediamtx.yml /opt/mediamtx/mediamtx.yml
sudo nano /opt/mediamtx/mediamtx.yml   # publishUser/publishPass + tu stream key real
sudo chown -R mediamtx:mediamtx /opt/mediamtx
sudo chmod 600 /opt/mediamtx/mediamtx.yml   # la stream key vive aquí, protégela

# 3. systemd
sudo cp deploy/systemd/mediamtx.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mediamtx
```

## Firewall

```bash
sudo ufw allow 8189/udp   # ICE del WebRTC/WHIP — SÍ debe estar abierto a internet
# el puerto 8889 (HTTP de WHIP) NO se abre directo: pasa por Caddy en 443
# el puerto 8554 (RTSP interno) NO se abre: solo lo usa ffmpeg en localhost
```

Caddy ya tiene el `handle /whip/*` añadido en `deploy/caddy/Caddyfile` apuntando a `127.0.0.1:8889`.

## Configurar la app

Abre `chromeos-app` (desplegada como estáticos en cualquier HTTPS, o en local con `npm run dev` + un túnel para probar `getDisplayMedia` que exige contexto seguro) y rellena:

- **WHIP endpoint**: `https://tu-dominio/whip/live`
- **Usuario/contraseña**: los `publishUser`/`publishPass` que pusiste en `mediamtx.yml`.

## Seguridad

- La stream key real de Twitch/YouTube vive solo en `/opt/mediamtx/mediamtx.yml` en la Pi (permisos 600), nunca en el repo ni en el navegador.
- Las credenciales WHIP (usuario/contraseña del path `live`) sí se guardan en `localStorage` del navegador que uses — son un secreto de bajo riesgo (solo permiten publicar en ese path, no ver la stream key ni acceder a OBS), pero si usas un Chromebook compartido, no los guardes.
- Cambia `publishUser`/`publishPass` por valores largos y aleatorios (`openssl rand -hex 16`), nunca los de ejemplo del archivo.
