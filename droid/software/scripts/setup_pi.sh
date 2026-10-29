#!/usr/bin/env bash
# Prepara una Raspberry Pi 5 (Raspberry Pi OS 64-bit) para Pío. Ejecútalo como tu usuario normal.
set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)

sudo apt-get update
sudo apt-get install -y python3-venv python3-picamera2 python3-opencv python3-lgpio \
  libportaudio2 git cmake build-essential libcurl4-openssl-dev

# Buses: SPI (pantalla), I2C (PCA9685 + ToF), I2S (amplificador MAX98357A: la Pi 5 no tiene jack)
sudo raspi-config nonint do_spi 0
sudo raspi-config nonint do_i2c 0
CFG=/boot/firmware/config.txt
grep -q '^dtoverlay=max98357a' "$CFG" || echo 'dtoverlay=max98357a' | sudo tee -a "$CFG" >/dev/null

# Entorno Python (ve picamera2 y opencv del sistema)
python3 -m venv --system-site-packages "$HERE/.venv"
"$HERE/.venv/bin/pip" install -r "$HERE/requirements-pi.txt"

# Detector de caras YuNet (~230 KB)
mkdir -p "$HERE/models"
[ -f "$HERE/models/face_detection_yunet_2023mar.onnx" ] || curl -fL -o "$HERE/models/face_detection_yunet_2023mar.onnx" \
  https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx

# llama.cpp: el servidor que ejecuta la VLM en la CPU de la Pi
if [ ! -x "$HOME/llama.cpp/build/bin/llama-server" ]; then
  git clone --depth 1 https://github.com/ggml-org/llama.cpp "$HOME/llama.cpp"
  cmake -S "$HOME/llama.cpp" -B "$HOME/llama.cpp/build" -DCMAKE_BUILD_TYPE=Release
  cmake --build "$HOME/llama.cpp/build" -j4 --target llama-server
fi

echo
echo "Listo. Reinicia (para el overlay de audio) y luego:"
echo "  sudo cp $HERE/systemd/*.service /etc/systemd/system/ && sudo systemctl daemon-reload"
echo "  sudo systemctl enable --now pio-vlm pio"
