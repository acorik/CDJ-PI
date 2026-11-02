# CDJ-PI LOOP — loop station para Chromebook

Estación de loops que corre **dentro de Chrome** en un Chromebook de 4 GB: eliges un sonido, pulsas una pista, suena la cuenta atrás (1-2-3-4), tocas, y el loop se repite solo. Luego otra pista encima, overdub, deshacer, efectos… La idea es hacer un beat en directo capa a capa. Se controla con ratón/teclado, con la **Numark Mixtrack Platinum FX**, con el **Akai MPD218** o con cualquier teclado MIDI USB.

Sin instalar nada, sin servidor, ~140 KB de código.

## Qué trae

- **8 pistas de loop** grabadas como audio de verdad (AudioWorklet, precisión de muestra):
  - cuenta atrás de 1 compás, metrónomo (no se graba),
  - longitud 1 / 2 / 4 / 8 compases o **LIBRE** (cierras el loop al volver a pulsar),
  - REC → PLAY o REC → DUB, overdub ilimitado, **deshacer/rehacer** la última capa, reverse, stop, borrar, volumen,
  - todas las pistas encajadas a una rejilla común: un loop de 1 compás y otro de 4 nunca se desfasan,
  - **compensación de latencia**: lo grabado cae donde lo tocaste al oírlo (con ajuste fino en Ajustes),
  - si pulsas REC un pelín tarde (hasta 150 ms después del "1"), cuenta desde ese compás en vez de esperar al siguiente,
  - costura del loop con crossfade (sin "clic" al dar la vuelta).
- **Sinte polifónico** (sustractivo + FM, unísono/supersaw, filtro de 2/4 polos con envolvente, LFO, glide, drive, chorus, delay a tempo, reverb, arpegiador sincronizado) con **139 presets** en 12 categorías: bajos (808, reese, acid, moog, wobble…), leads, pads, keys (rhodes, wurli, clavinet…), plucks, campanas, brass y cuerdas, órganos, arps, 8-bit, FX y voces. Macros en directo: cutoff, resonancia, attack, release, LFO.
- **Baterías** sintetizadas: TR-808, TR-909, Trap, Boom Bap y House/Techno (16 sonidos cada una, con velocidad). Puedes arrastrar tus propios samples a los pads.
- **Acordes en la tonalidad**: 8 pads con los acordes diatónicos (tríadas o con 7ª) de la tonalidad y escala elegidas; las teclas de la escala salen marcadas en el teclado.
- **FX**: FX1 de entrada (se graba en el loop), FX2 sobre los loops, y 16 **FX de directo** sobre todo el master a tempo (echo/reverb throw, beat repeat, sweeps, gate, crush, flanger, tape stop, bass kill, riser, impact, air horn).
- **Micro / entrada de línea**: graba voz, beatbox o guitarra en los loops.
- **Sesiones** guardadas en el Chromebook, **exportar WAV** de cada loop + mezcla, y **grabar el directo** entero a .webm.

## Cómo se usa

1. **EMPEZAR** y acepta el permiso MIDI si tienes controladoras.
2. Elige tempo (o TAP), compases (1/2/4/8/LIBRE) y tonalidad.
3. Pulsa el botón grande de la pista 1 (o la tecla **1**): cuenta atrás y a grabar. Toca batería, notas o acordes.
4. Al acabar, el loop suena. Pulsa la pista 2 para la siguiente capa, o la misma pista para **DUB** (grabar encima) y otra vez para volver a PLAY.
5. ↶ deshace la última capa. **Espacio** = play/stop. **Enter** = arrancar todas.

Teclado del ordenador: **A W S E D F T G Y H U J K O L P** = piano, **Z/X** = octava, **1-8** = pistas (Mayús+número = parar), **↑↓** preset, **←→** categoría.

## Controladoras

**Akai MPD218** (Program 1 de fábrica; si usas otro preset: *⚙ → Aprender MPD218*):

| | |
| --- | --- |
| Banco A | Batería (16 pads con velocidad) |
| Banco B | Notas del sinte en la escala elegida |
| Banco C | Pads 1-8: botón de las pistas 1-8 · pads 9-16: acordes |
| Knobs A | Cutoff · resonancia · attack · release · LFO · nivel FX de entrada |
| Knobs B | Volumen batería · filtro batería · drive · kick decay · kick tune · hat decay |
| Knobs C | Filtro master · volumen loops · volumen instrumentos · nivel FX loops · clic · preset |
| Note Repeat | La app le envía MIDI clock: pulsa una vez *NR CONFIG + pad 15 (Ext Clock)* en el MPD218 y los redobles irán al tempo |

**Numark Mixtrack Platinum FX:**

| | |
| --- | --- |
| Pads izquierda (HOT CUE) | Pistas 1-8 · SHIFT+pad = parar (dos veces con la pista parada = borrar) · AUTO LOOP / SAMPLE: FX de directo |
| Pads derecha | HOT CUE: batería 1-8 · AUTO LOOP: batería 9-16 · FADER CUTS: notas · SAMPLE: acordes |
| PLAY · CUE · SYNC | Play/stop (SHIFT: parar pistas) · metrónomo · tap tempo (SHIFT: cuenta atrás) |
| Plato izq. / navegador | Elegir preset (pulsar navegador: categoría) · LOAD: kit anterior/siguiente |
| Plato der. | Tocar + girar = pitch bend |
| Knobs canal 1 / canal 2 | Sinte (volumen, cutoff, resonancia, release, LFO) / batería (volumen, hat decay, tono, kick decay, filtro) |
| Faders | Instrumentos · loops · crossfader = filtro master · pitch izq. = cutoff · pitch der. = nivel FX loops |
| FX | Unidad 1 = FX de entrada, unidad 2 = FX de loops (palanca, knob, botones 1-3 configurables, TAP) |
| LOOP · ½ · ×2 | Deshacer en la pista seleccionada (SHIFT: rehacer) · duración del loop −/+ |
| Pantallas de los platos | BPM, tiempo, anillo = posición en el compás |

**Cualquier otro teclado MIDI USB** toca el sinte (con pitch bend, rueda de modulación → LFO y CC74 → cutoff).

> **Aviso honesto:** los números MIDI de la Platinum FX salen del mapeo de la comunidad de Mixxx, y los de los bancos B/C del MPD218 son los habituales pero no los he confirmado en una fuente oficial: **no lo he probado con el hardware físico**. Para depurar: *⚙ → Monitor MIDI*; para el MPD218 está el asistente de aprendizaje.

## Ponerla en el Chromebook

- **Zip**: *Actions → CI → Artifacts → `chromeos-loop-dist`*, descomprime en Descargas y abre `index.html`. Funciona abriendo el archivo local (probado).
- **Como app instalable y sin internet**: *Settings → Pages → Source: GitHub Actions*, luego *Actions → "Loop app → GitHub Pages" → Run workflow*, abre la URL en el Chromebook e instálala.
- **Compilar**: `npm install && npm run build` (`npm run dev` sirve en http://localhost:5174, `npm test` pasa los tests).

## RAM y CPU (4 GB)

Un loop de 4 compases a 90 BPM ocupa ~4 MB (estéreo float a 48 kHz); 8 pistas llenas con deshacer, ~60-80 MB. El sinte usa osciladores nativos de Chrome (poco CPU); máximo 10 voces a la vez. Si oyes cortes: *⚙ → Latencia → Equilibrada* y 30 fps.

## Estructura

```
src/
  looper/   worklet del looper (8 pistas), transporte, controlador estilo loop station, WAV
  synth/    motor del sinte, 139 presets, escalas y acordes
  drums/    kits sintetizados y caja de ritmos
  audio/    FX (unidades y FX de directo)
  midi/     Platinum FX, MPD218 (+ asistente), teclados MIDI, MIDI clock
  ui/       interfaz sin framework (canvas para pistas)
test/       tests del looper (sincronía, latencia, overdub, costura), teoría y presets
```
