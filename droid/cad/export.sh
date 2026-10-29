#!/usr/bin/env bash
# Exporta todas las piezas imprimibles de Pío a STL (carpeta ./stl).
# Requiere OpenSCAD >= 2021.01. En un servidor sin pantalla: xvfb-run ./export.sh
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p stl
parts=(body_bottom body_top chassis head_front head_back visor beak neck foot_left foot_right tail antenna)
for p in "${parts[@]}"; do
  echo ">> $p"
  openscad -q --export-format binstl -D "part=\"$p\"" -o "stl/$p.stl" pio.scad &
done
wait
ls -la stl
