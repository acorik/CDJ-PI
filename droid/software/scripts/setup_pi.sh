#!/usr/bin/env bash
# Instala (o actualiza) Pío en una Raspberry Pi 5 con Raspberry Pi OS 64-bit.
#
#   ./scripts/setup_pi.sh            instalación completa (ejecútalo como tu usuario; pide sudo)
#   ./scripts/setup_pi.sh --update   solo copia el código/config nuevos y reinicia los servicios
#
# Qué hace y por qué:
#   - Crea el usuario de sistema `pio`, SIN sudo ni login: si alguien comprometiera el droide,
#     no tendría tu usuario (que en Raspberry Pi OS suele tener sudo sin contraseña).
#   - Copia el código a /opt/pio, propiedad de root: el servicio no puede modificarse a sí mismo.
#   - llama.cpp en una versión fija (tag + commit comprobado) y los modelos con su SHA-256:
#     si alguien cambia un fichero en origen, la instalación se para en vez de usarlo.
#   - Servicios systemd aislados: el droide solo puede hablar con 127.0.0.1 y la VLM no tiene
#     dispositivos ni red exterior.
set -euo pipefail
SRC=$(cd "$(dirname "$0")/.." && pwd)
DEST=/opt/pio

# --- versiones fijadas (actualízalas a propósito, nunca "lo último") -------------------
LLAMA_TAG=b11800
LLAMA_COMMIT=d454a204ef2b63af357744809c05af897611a72e
HF=https://huggingface.co
VLM_URL=$HF/ggml-org/SmolVLM2-500M-Video-Instruct-GGUF/resolve/ccd7aae53bcb1997355c2f094959e72b3642ce17
VLM_FILE=SmolVLM2-500M-Video-Instruct-Q8_0.gguf
VLM_SHA=6f67b8036b2469fcd71728702720c6b51aebd759b78137a8120733b4d66438bc
MMPROJ_FILE=mmproj-SmolVLM2-500M-Video-Instruct-Q8_0.gguf
MMPROJ_SHA=921dc7e259f308e5b027111fa185efcbf33db13f6e35749ddf7f5cdb60ef520b
YUNET_URL=$HF/opencv/face_detection_yunet/resolve/3cc26e7f1014a5ee5d74a42acee58bafc9d0a310/face_detection_yunet_2023mar.onnx
YUNET_SHA=8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4

UPDATE=0
[ "${1:-}" = "--update" ] && UPDATE=1

fetch() {  # url sha256 destino: descarga solo por HTTPS y comprueba el hash antes de usarlo
  local url=$1 sha=$2 dest=$3
  if [ -f "$dest" ] && echo "$sha  $dest" | sha256sum -c --status; then return; fi
  echo "   descargando $(basename "$dest")..."
  sudo curl -fL --proto '=https' --tlsv1.2 -o "$dest.part" "$url"
  if ! echo "$sha  $dest.part" | sha256sum -c --status; then
    sudo rm -f "$dest.part"
    echo "¡SHA-256 incorrecto para $url! No instalo nada." >&2
    exit 1
  fi
  sudo mv "$dest.part" "$dest"
}

if [ "$UPDATE" = 0 ]; then
  echo "== Paquetes del sistema"
  sudo apt-get update
  sudo apt-get install -y python3-venv python3-picamera2 python3-opencv python3-lgpio \
    libportaudio2 git cmake build-essential rsync

  echo "== Buses: SPI (pantalla), I2C (servos + ToF), I2S (altavoz; la Pi 5 no tiene jack)"
  sudo raspi-config nonint do_spi 0
  sudo raspi-config nonint do_i2c 0
  CFG=/boot/firmware/config.txt
  grep -q '^dtoverlay=max98357a' "$CFG" || echo 'dtoverlay=max98357a' | sudo tee -a "$CFG" >/dev/null

  echo "== Usuario de sistema 'pio' (sin sudo, sin login)"
  id pio >/dev/null 2>&1 || sudo useradd --system --home-dir /var/lib/pio --no-create-home \
    --shell /usr/sbin/nologin pio
  for g in gpio spi i2c video audio; do
    getent group "$g" >/dev/null && sudo usermod -aG "$g" pio
  done
fi

echo "== Código y configuración en $DEST (propiedad de root, solo lectura para el servicio)"
sudo install -d -o root -g root -m 755 "$DEST" "$DEST/models" "$DEST/bin"
sudo rsync -a --delete --chown=root:root \
  --exclude .venv --exclude models --exclude bin --exclude tests \
  --exclude __pycache__ --exclude .pytest_cache "$SRC/" "$DEST/"

if [ "$UPDATE" = 0 ] || [ ! -x "$DEST/.venv/bin/python" ]; then
  echo "== Entorno Python"
  sudo python3 -m venv --system-site-packages "$DEST/.venv"
fi
sudo "$DEST/.venv/bin/pip" install -q -r "$DEST/requirements-pi.txt"

echo "== Modelos (versión fija + SHA-256)"
fetch "$YUNET_URL" "$YUNET_SHA" "$DEST/models/face_detection_yunet_2023mar.onnx"
fetch "$VLM_URL/$VLM_FILE" "$VLM_SHA" "$DEST/models/vlm.gguf"
fetch "$VLM_URL/$MMPROJ_FILE" "$MMPROJ_SHA" "$DEST/models/vlm-mmproj.gguf"

if [ "$(cat "$DEST/bin/llama-server.commit" 2>/dev/null)" != "$LLAMA_COMMIT" ]; then
  echo "== llama.cpp $LLAMA_TAG (compilación estática; tarda unos 15-20 min en la Pi)"
  B=$(mktemp -d)
  trap 'rm -rf "$B"' EXIT
  git clone -q --depth 1 --branch "$LLAMA_TAG" https://github.com/ggml-org/llama.cpp "$B/llama.cpp"
  if [ "$(git -C "$B/llama.cpp" rev-parse HEAD)" != "$LLAMA_COMMIT" ]; then
    echo "¡El tag $LLAMA_TAG no apunta al commit esperado! No instalo nada." >&2
    exit 1
  fi
  cmake -S "$B/llama.cpp" -B "$B/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
    -DLLAMA_OPENSSL=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF
  cmake --build "$B/build" -j4 --target llama-server
  sudo install -o root -g root -m 755 "$B/build/bin/llama-server" "$DEST/bin/llama-server"
  echo "$LLAMA_COMMIT" | sudo tee "$DEST/bin/llama-server.commit" >/dev/null
fi

echo "== Servicios"
sudo install -o root -g root -m 644 "$SRC/systemd/pio.service" "$SRC/systemd/pio-vlm.service" /etc/systemd/system/
sudo systemctl daemon-reload
if [ "$UPDATE" = 1 ]; then
  sudo systemctl try-restart pio-vlm pio
  echo "Actualizado."
  exit 0
fi

cat <<'EOF'

Listo. Siguientes pasos:
  1. sudo reboot                                   (activa el overlay de audio)
  2. Prueba y calibra con el servicio parado, desde la carpeta del repo:
       /opt/pio/.venv/bin/python scripts/test_hw.py
       /opt/pio/.venv/bin/python scripts/calibrar_servos.py
       ./scripts/setup_pi.sh --update              (copia la config calibrada a /opt/pio)
  3. sudo systemctl enable --now pio-vlm pio
     journalctl -u pio -f                          (lo que piensa)
     sudo cat /var/lib/pio/.pio/diario.jsonl       (lo que ha visto)

Recomendado para la Pi (ver droid/README.md, sección Seguridad):
  - SSH solo con clave:      PasswordAuthentication no  en /etc/ssh/sshd_config
  - Cortafuegos:             sudo apt install ufw && sudo ufw allow ssh && sudo ufw enable
  - Actualizaciones:         sudo apt install unattended-upgrades
EOF
