# CDJ-PI IRL (ChromeOS / Chrome)

App web minimalista, sin backend propio, para transmitir IRL desde un Chromebook (o cualquier Chrome) con poca RAM:

- Captura **pantalla completa/ventana** (`getDisplayMedia`), **micrófono** y **cámara** (`getUserMedia`).
- Las compone en un `<canvas>` (cámara en una esquina, chat de Twitch opcional superpuesto).
- Publica ese canvas vía **WHIP** (WebRTC), que usa el encoder hardware del propio Chromebook — nada de software encoding pesado.
- Sin frameworks, sin dependencias en runtime: el bundle entero son unos pocos KB, para no competir por RAM con el propio juego/app que estés capturando.

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

## Nota de seguridad

Las credenciales del WHIP se guardan en `localStorage` de **tu** navegador para no tener que escribirlas cada vez — nunca se envían a ningún sitio salvo al propio endpoint WHIP que configures, y nunca a un backend intermedio (esta app no tiene backend). Si usas un Chromebook compartido, no marques "guardar" o bórralas después (DevTools → Application → Local Storage).
