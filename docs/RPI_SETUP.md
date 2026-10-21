# Instalación en la Raspberry Pi

Pensado para Raspberry Pi 4/5 con Raspberry Pi OS 64-bit (Bookworm).

## 1. Sistema base

```bash
sudo apt update && sudo apt full-upgrade -y
sudo raspi-config  # Performance > GPU memory: 256MB; habilita SSH si lo necesitas
```

Para IRL con streams largos, vigila la temperatura: usa disipador/ventilador activo. `vcgencmd measure_temp` no debería pasar de ~70°C sostenido.

## 2. OBS Studio optimizado

```bash
sudo apt install -y obs-studio
```

En OBS:
- Configuración de salida: encoder **h264_v4l2m2m (hardware)**, no x264 software.
- Canvas 1280x720 @ 30fps (sube solo si la CPU va sobrada).
- Bitrate adaptado a tu subida real (IRL: deja margen, no uses el 100% de tu subida 4G/WiFi).
- Activa obs-websocket (Herramientas → obs-websocket Settings): puerto `4455`, **contraseña obligatoria**, y que escuche solo en loopback (por defecto escucha en todas las interfaces — bloquéalo con el firewall en el paso 5, no confíes solo en la config de OBS).

## 3. Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
```

## 4. Clonar y configurar

```bash
git clone <tu-fork-o-este-repo> /opt/cdj-pi
cd /opt/cdj-pi/backend
cp .env.example .env
nano .env   # rellena JWT_SECRET, JWT_REFRESH_SECRET, ADMIN_PASSWORD_HASH, OBS_WS_PASSWORD
npm ci --omit=dev
npm run build

cd ../frontend
cp .env.example .env
npm ci
npm run build   # genera frontend/dist, que Caddy servirá como estáticos
```

Genera los secretos así (no los escribas a mano):

```bash
openssl rand -base64 48   # para JWT_SECRET
openssl rand -base64 48   # para JWT_REFRESH_SECRET (uno distinto)
node -e "console.log(require('bcryptjs').hashSync('TU_PASSWORD_AQUI', 12))"  # para ADMIN_PASSWORD_HASH
```

## 5. Firewall

```bash
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp     # SSH — considera restringirlo a tu IP o quitarlo si usas solo VPN
sudo ufw allow 443/tcp    # panel (vía Caddy)
# OBS-websocket (4455) NUNCA se abre aquí — solo debe ser alcanzable desde localhost
sudo ufw enable
```

## 6. Acceso remoto: VPN en vez de exponer a internet (recomendado)

En vez de abrir 443 al mundo, instala Tailscale o WireGuard y accede al panel solo desde dentro de tu VPN:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Así el panel ni siquiera necesita estar en `ufw allow 443` global — solo accesible por la IP de la VPN.

## 7. systemd (backend)

```bash
sudo cp deploy/systemd/cdj-backend.service /etc/systemd/system/
sudo mkdir -p /etc/cdj-pi
sudo cp backend/.env /etc/cdj-pi/backend.env
sudo chmod 600 /etc/cdj-pi/backend.env
sudo systemctl daemon-reload
sudo systemctl enable --now cdj-backend
sudo systemctl status cdj-backend
```

## 8. Caddy (TLS + reverse proxy)

```bash
sudo apt install -y caddy
sudo cp deploy/caddy/Caddyfile /etc/caddy/Caddyfile
# edita el dominio o, si es solo LAN/VPN, usa `tls internal` (certificado local)
sudo systemctl restart caddy
```

## 9. Arranque automático de OBS en modo kiosco (opcional)

Si el Pi va sin monitor, considera lanzar OBS con `obs --startstreaming --minimize-to-tray` dentro de una sesión gráfica mínima (labwc/wayfire) arrancada por systemd. No incluido en este repo porque depende mucho de tu setup físico; documentar aquí para no inventar una solución frágil y genérica.
