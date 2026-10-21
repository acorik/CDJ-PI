# CDJ-PI IRL (ChromeOS / Chrome)

App web minimalista, sin backend propio, para transmitir IRL desde un Chromebook (o cualquier Chrome) con poca RAM:

- Captura **pantalla completa/ventana** (`getDisplayMedia`), **micrófono** (`getUserMedia`) y una cámara, que puede ser:
  - una webcam local normal, o cualquier dispositivo que ChromeOS vea como cámara UVC (Continuity Camera, alguna app tipo Elgato si expone un dispositivo así — ver nota más abajo), o
  - **el iPhone vía [VDO.Ninja](https://vdo.ninja)**: no necesita instalar nada, solo abrir un link en Safari.
- Compone todas las capas (escritorio + cámara/VDO.Ninja + chat) **en el propio DOM**, no en un `<canvas>`, y al final auto-captura la pestaña entera. Es la única forma de incluir un iframe de otro dominio (VDO.Ninja) sin que salte la protección de "canvas contaminado" del navegador.
- Publica ese resultado vía **WHIP** (WebRTC), que usa el encoder hardware del propio Chromebook — nada de software encoding pesado.
- Sin frameworks, sin dependencias en runtime: el bundle entero son unos pocos KB, para no competir por RAM con el propio juego/app que estés capturando.

## Cámara del iPhone (VDO.Ninja)

1. En la app, pon "Fuente de cámara" → **iPhone vía VDO.Ninja** y pulsa "Empezar".
2. Te aparece un link (`https://vdo.ninja/?push=...`). Ábrelo en Safari **en el iPhone** (misma red o por 4G, da igual) y dale permiso de cámara.
3. La imagen del iPhone aparece como PiP en la esquina de tu stream, con la latencia típica de WebRTC (~100-300ms), nada que ver con mandar el vídeo por otro lado y sincronizarlo a mano.

No hace falta cuenta ni instalar nada en el iPhone — solo Safari.

## Elgato Cam

La app **Elgato Camera Hub** (la que convierte el iPhone en webcam) solo tiene cliente de escritorio para Mac/Windows, no hay versión ChromeOS — por eso no es la vía recomendada aquí. Si de todas formas tu Chromebook ve el iPhone como una cámara normal (p. ej. por USB con alguna app que sí soporte UVC en ChromeOS), te saldrá sola en el desplegable "Dispositivo" al elegir "Webcam local" — no necesita código especial, es una cámara más para el navegador. Para iPhone, VDO.Ninja es la vía que de verdad funciona en ChromeOS sin instalar nada.

## Por qué WHIP y no "un OBS en el navegador"

OBS necesita Linux (Crostini) en ChromeOS, que por sí solo ya consume al menos 1-1.5GB de RAM reservados a la VM antes de arrancar nada — inviable con 4GB totales si además quieres jugar o usar la cámara. WHIP delega la codificación al hardware del Chromebook a través de las mismas APIs que usa Google Meet, así que el coste real es el mínimo posible en ese hardware.

## Uso

```bash
cd chromeos-app
npm install
npm run dev     # desarrollo
npm run build    # genera dist/, sirve esos estáticos desde cualquier HTTPS (necesario: getDisplayMedia exige contexto seguro)
```

Instálala como app (Chrome → menú → "Instalar CDJ-PI IRL") para que abra en su propia ventana sin barra de pestañas — un poco menos de RAM para el propio Chrome.

En el formulario:
- **WHIP endpoint**: la URL del relay (ver `../deploy/mediamtx/`), p. ej. `https://tu-pi.example.com/whip/live`.
- **Usuario/contraseña**: credenciales del path WHIP configurado en MediaMTX (no son tu cuenta de Twitch/YouTube).
- **Canal de Twitch**: opcional, solo para overlay de lectura del chat (anónimo, no publica nada).

Al pulsar "Empezar" te van a salir **varios** permisos de golpe, en este orden: compartir pantalla/ventana → (si toca) cámara → micrófono → compartir "Esta pestaña" (el paso que auto-captura todo lo anterior ya compuesto). Elige exactamente "Esta pestaña" en ese último — si eliges otra cosa, el stream sale en blanco o repetido.

## Nota de seguridad

- Las credenciales del WHIP se guardan en `localStorage` de **tu** navegador para no tener que escribirlas cada vez — nunca se envían a ningún sitio salvo al propio endpoint WHIP que configures, y nunca a un backend intermedio (esta app no tiene backend). Si usas un Chromebook compartido, no marques "guardar" o bórralas después (DevTools → Application → Local Storage).
- Si usas VDO.Ninja, tu vídeo de cámara pasa por la infraestructura pública de `vdo.ninja` (servidor de señalización + su TURN) antes de llegar a tu navegador — es un proyecto open-source y gratuito pensado justo para esto, pero es un tercero fuera de tu control, a diferencia del resto del pipeline (backend propio, tu Pi). Si eso te preocupa para contenido sensible, usa solo la webcam local.
