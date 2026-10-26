#!/usr/bin/env bash
# Renderiza las imágenes de ../docs/img a partir del modelo. Sin pantalla: xvfb-run ./render.sh
set -euo pipefail
cd "$(dirname "$0")"
out=../docs/img
mkdir -p "$out"
r() { openscad -q -o "$out/$1.png" --imgsize=1000,1100 --colorscheme=Tomorrow --projection=p --camera="$2" "${@:3}" pio.scad; }
r pio_hero     "330,520,330,0,0,110" &
r pio_front    "0,640,150,0,0,110" &
r pio_side     "640,40,150,0,0,110" &
r pio_eh       "330,520,330,0,0,110" -D roll=18 -D pan=-20 -D tilt=8 &
r pio_cutaway  "560,330,240,0,0,100" -D 'part="cutaway"' -D antennas=false &
wait
