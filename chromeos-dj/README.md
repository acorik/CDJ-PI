# CDJ-PI DJ (ChromeOS + Numark Mixtrack Platinum FX)

App de DJ que corre **dentro de Chrome** en un Chromebook de 4 GB, pensada para conectar una **Numark Mixtrack Platinum FX** por USB y pinchar como con Serato DJ, con funciones de CDJ añadidas. Sin instalar Linux, sin servidor, ~150 KB de código.

- **4 decks** (capas 1/3 y 2/4 como en la controladora), waveforms paralelos con scroll, overview con needle search, plato virtual.
- **Sync de verdad**: iguala tempo **y fase** con precisión de muestra (los 4 decks corren en un único AudioWorklet), con half/double-time automático y MASTER que se traspasa al parar.
- **Master Tempo / key lock** (WSOLA), **key shift** ±12 y **KEY SYNC** (ajusta la tonalidad a la del master con la rueda Camelot).
- **Análisis**: BPM + beatgrid + downbeat, tonalidad (Camelot / Open Key / clásica), loudness para **auto gain**, waveform RGB de 3 bandas. Se hace en un Web Worker y se guarda: cada pista se analiza una sola vez.
- **Biblioteca**: carpetas de USB / SD / Google Drive (File System Access), etiquetas ID3/FLAC/MP4, búsqueda, crates, "★ Preparar", historial de sesión exportable como setlist, filtro **COMPATIBLES** (tonalidad ±1 y BPM ±6 % del master), puntuación y colores, backup/importación de cues y crates en JSON.
- **Mezclador**: trim, EQ isolator de 3 bandas con kill real, filtro LPF/HPF, PFL, crossfader con curvas, limitador, VUs, grabación de la sesión a `.webm`.
- **FX**: 2 unidades beat-sync (Echo, Ping Pong, Reverb, Flanger, Phaser, Filter LFO, Trans, Crush, Noise, Roll) con TAP, + sampler de 8 slots con sonidos sintetizados (sustituibles por tus archivos).

## Funciones de CDJ incluidas

| CDJ | Aquí |
| --- | --- |
| CUE estilo CDJ (fijar en pausa, preview manteniendo, back cue) | Botón CUE de la controladora / UI |
| Hot cues A-H con colores, saved loops en hot cues | Pads en modo HOT CUE (si hay loop activo al guardar, se guarda el loop) |
| Hot cue en pausa = preview mientras mantienes | Sí |
| Memory cues + CALL ◀ ▶ | Fila MEMORY / CALL / DEL del deck |
| 4-beat loop, loop IN/OUT, RELOOP/EXIT, ½ ×2, loop move | Botones LOOP, SHIFT+½ / SHIFT+×2, beat jump con loop activo |
| Beat jump | Modo de pads BEAT JUMP y ◀ ▶ en la UI |
| Quantize | Hot cues, loops y saltos caen en el beat manteniendo la fase |
| Slip mode | SHIFT+CUE(auricular); funciona con scratch, loops, roll, censor y reverse |
| Reverse / censor | REV en la UI · SHIFT+SCRATCH en la controladora |
| Vinyl / CDJ mode del jog | Botón SCRATCH |
| Rango de tempo ±6/8/10/16/WIDE, tempo reset | SHIFT+bend ◀ · doble clic en el slider |
| Master Tempo (key lock) | SHIFT+bend ▶ |
| Beat sync + MASTER | SYNC · SHIFT+SYNC |
| Key shift / Key sync (CDJ-3000) | Modo de pads KEY SHIFT |
| Instant doubles | Doble pulsación de LOAD |
| Auto cue (primer sonido) | Ajustes |
| Load lock / needle lock | Ajustes |
| Aviso de fin de pista (< 30 s) | Overview, plato y tiempo parpadean en rojo |
| Contador de beat en el compás / medidor de fase | Bajo el overview · barra verde/roja en el waveform |
| Vinyl brake / spinback, velocidad de arranque/frenado | Modo PAD FX · Ajustes |
| Fader start | Ajustes |
| Historial (como el "history" de rekordbox) | Biblioteca → HISTORIAL |

## Cómo usarla en el Chromebook

Tres formas, de más cómoda a más manual:

1. **Instalarla desde GitHub Pages (recomendado: queda como app y funciona sin internet)**
   1. En GitHub: *Settings → Pages → Source: GitHub Actions*.
   2. *Actions → "DJ app → GitHub Pages" → Run workflow*.
   3. Abre la URL que te da (`https://<usuario>.github.io/<repo>/`) en el Chromebook y pulsa *Instalar* en la barra de direcciones. A partir de ahí abre como app propia y funciona offline (en una fiesta sin wifi también).
   > Si el repo es privado, Pages puede requerir plan de pago de GitHub; usa la opción 2.
2. **Descargar el zip ya compilado**: *Actions → CI → último run → Artifacts → `chromeos-dj-dist`*. Descomprímelo en *Descargas* y abre `index.html` desde la app *Archivos* (doble clic). Funciona igual por `file://` (probado), aunque así no se puede "instalar" como app.
3. **Compilarla tú** (necesita Linux/Crostini o cualquier PC con Node 18+):
   ```bash
   cd chromeos-dj
   npm install
   npm run build    # -> dist/
   npm run dev      # servidor local con recarga en http://localhost:5174
   npm test         # tests de análisis, motor de audio, tonalidades y etiquetas
   ```

### Primer arranque

1. Pulsa **EMPEZAR**. Chrome pedirá permiso para **dispositivos MIDI** (acepta, incluido el control total/sysex: es lo que enciende las pantallas de los platos).
2. Conecta la Platinum FX (antes o después: se detecta sola, también si la desconectas y vuelves a conectar).
3. Biblioteca → **CARPETAS +** → elige la carpeta de música (pendrive, SD, Drive…). Después de reiniciar Chrome te pedirá **RECONECTAR** con un clic (es una regla de seguridad de Chrome).
4. Pulsa **ANALIZAR** para preparar BPM, tonalidad y waveforms de todo (una pista a la vez para no llenar la RAM). Lo que no esté analizado se analiza al cargarlo.

### Audio: master y auriculares

En **⚙ Ajustes → Audio**:

| Modo | Para qué |
| --- | --- |
| Controladora 4 canales | La Platinum FX es interfaz de audio de 4 canales: master por 1-2 (salida RCA) y auriculares por 3-4. Elige la Platinum FX como *Dispositivo master*. |
| Split cue | Un solo dispositivo estéreo: master mono por la izquierda y auriculares mono por la derecha (cable splitter). |
| Dos dispositivos | Master por un dispositivo (p. ej. la controladora) y auriculares por otro (p. ej. el jack del Chromebook). |
| Solo master | Sin pre-escucha. |

> **Aviso honesto:** no he podido comprobar en un Chromebook real si ChromeOS expone los 4 canales de la Platinum FX a Chrome. La app lo detecta: si el dispositivo solo da 2 canales, cae a *master estéreo* y en Ajustes te lo indica; entonces usa **Dos dispositivos** (master por la controladora, auriculares por el jack del Chromebook) o **Split cue**.

Si oyes cortes, sube **Latencia** a *Equilibrada* o *Segura* (se aplica al recargar) y pon la app a **30 fps**.

## Mapeo de la Mixtrack Platinum FX

| Control | Acción |
| --- | --- |
| PLAY / CUE | CDJ: CUE en pausa fija el punto; mantener = preview; CUE sonando = vuelve y para. SHIFT+PLAY = stutter · SHIFT+CUE = inicio |
| SYNC | Beat sync · SHIFT+SYNC = MASTER |
| Plato | Tocar = scratch (modo VINYL) · borde = nudge · SHIFT+girar = búsqueda rápida |
| SCRATCH | Modo vinilo on/off · SHIFT+mantener = censor |
| PITCH BEND ◀ ▶ | Empujar · SHIFT+▶ = key lock · SHIFT+◀ = rango de pitch |
| Pitch fader | 14 bits, con *pickup* al cambiar de capa o al soltar sync |
| CUE (auriculares) | PFL · SHIFT = SLIP |
| LOOP / ½ / ×2 | 4-beat loop/salir · SHIFT+LOOP = reloop · SHIFT+½ = IN · SHIFT+×2 = OUT |
| HOT CUE | Pads A-H · 2ª pulsación o SHIFT+HOT CUE = BEAT JUMP (SHIFT+pad ×4) |
| AUTO LOOP | Loops 1/4…32 · 2ª pulsación = ROLL 1/16…8 |
| FADER CUTS | 8 patrones de cortes rítmicos al beat · 2ª pulsación = KEY SHIFT (−3…+3, 0, KEY SYNC) |
| SAMPLE | Sampler 8 slots (SHIFT+pad = parar) · 2ª pulsación o SHIFT+SAMPLE = PAD FX (echo ½, echo ¾, reverb, trans, roll ¼, roll ⅛, brake, spinback) |
| FX 1-3 / palanca / knob / TAP | Efecto (configurable) · arriba = fijo, abajo = momentáneo · beats · TAP tempo (SHIFT+TAP = automático) |
| Navegador | Girar = mover · pulsar = lista ↔ crates · SHIFT+pulsar = ★ Preparar · LOAD = cargar (doble = instant double) · SHIFT+LOAD = expulsar |
| DECK 1/3 · 2/4 | Cambia de capa |
| Pantallas de los platos | BPM, pitch %, tiempo (restante/transcurrido), anillo de posición, flechas de BPM respecto al otro deck, VU |

Los números de nota/CC y el formato sysex de las pantallas salen del mapeo de la comunidad de **Mixxx** para esta controladora (datos del protocolo del hardware; la lógica es propia). **No lo he probado con la controladora física** porque no la tengo aquí: si algo no responde, *⚙ Ajustes → Controladora MIDI → Monitor MIDI* muestra los mensajes exactos que envía la tuya y el mapeo está en `src/midi/platinumfx.ts`. Si los LEDs de los pads se ven raros, prueba otros valores en *Valor LED pad encendido/apagado*.

Sin controladora también se puede pinchar con ratón/teclado (pulsa **?** en la app para ver los atajos).

## RAM y rendimiento (4 GB)

- El audio de cada pista cargada vive como Int16 dentro del AudioWorklet: **~63 MB por cada 6 min** (48 kHz estéreo). 2 decks ≈ 130 MB, 4 decks ≈ 260 MB. Los *instant doubles* comparten memoria.
- El análisis por lotes decodifica a 22 kHz mono, de una en una (~30 MB de pico).
- Las waveforms ocupan ~220 KB por pista en IndexedDB; el PCM nunca se guarda.
- Motor (medido en Node, 4 decks con sync): ~1 % de un núcleo sin key lock, ~4 % con key lock en los 4 (en un Celeron espera 3-4×).
- Evita sesiones/mixes de más de ~20 min por archivo (un archivo de 1 h necesitaría >600 MB al decodificarse).
- Cierra otras pestañas pesadas mientras pinchas.

## Limitaciones conocidas (sin adornos)

- Beatgrids de tempo constante (como el modo normal de rekordbox/Serato). Para temas con tempo variable, ajusta el grid a mano (/2, ×2, ±0.01, mover, "1 AQUÍ").
- La detección de tonalidad es estadística (perfiles Krumhansl): acierta la mayoría en electrónica, puede fallar en temas modales o muy cromáticos.
- No importa bibliotecas de Serato ni rekordbox (sí respeta BPM/key de las etiquetas mientras no se analiza).
- Sin separación de stems.
- No hay vista previa independiente en auriculares (para pre-escuchar, carga en un deck libre y usa CUE).

## Estructura

```
src/
  worklet/engine-processor.ts  motor de 4 decks (cúbica, WSOLA, loops, slip, scratch, sync de fase)
  worker/analyzer-worker.ts    worker de análisis
  analysis/                    BPM/grid, tonalidad, waveform, loudness (puro, testeado en Node)
  audio/                       AudioContext, mezclador, FX, sampler, decodificación
  deck.ts · app.ts             lógica de deck estilo CDJ, master/sync, análisis por lotes
  midi/                        Web MIDI, mapeo Platinum FX, fader cuts
  library/                     IndexedDB, carpetas, etiquetas, crates, historial
  ui/                          interfaz sin framework (canvas para waveforms y platos)
test/                          tests (npm test)
scripts/build.mjs              build con esbuild (funciona por https y por file://)
```
