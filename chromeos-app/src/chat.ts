// Chat de Twitch, lectura anónima (sin login) vía IRC-sobre-WebSocket.
// Se pinta como texto normal del DOM dentro de #chatBox, no en un canvas:
// así se auto-captura igual que el resto de capas cuando se exporta la
// pestaña (ver capture.ts). Nada de librerías de IRC, son ~20 líneas.

const MAX_LINES = 6;

export interface ChatHandle {
  stop: () => void;
}

export function startChatOverlay(channel: string, container: HTMLElement): ChatHandle {
  container.hidden = false;
  container.innerHTML = "";

  let ws: WebSocket | null = null;
  let closed = false;

  function appendLine(text: string) {
    const p = document.createElement("p");
    p.textContent = text;
    container.appendChild(p);
    while (container.children.length > MAX_LINES) {
      container.removeChild(container.firstChild!);
    }
  }

  function connect() {
    if (closed) return;
    ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    ws.onopen = () => {
      ws?.send("PASS SCHMOOPIIE");
      ws?.send(`NICK justinfan${Math.floor(Math.random() * 100000)}`);
      ws?.send(`JOIN #${channel.toLowerCase().replace(/^#/, "")}`);
    };
    ws.onmessage = (event) => {
      for (const raw of String(event.data).split("\r\n")) {
        if (!raw) continue;
        if (raw.startsWith("PING")) {
          ws?.send("PONG :tmi.twitch.tv");
          continue;
        }
        const match = /^:(\w+)!\S+ PRIVMSG #\S+ :(.*)$/.exec(raw);
        if (match) appendLine(`${match[1]}: ${match[2]}`);
      }
    };
    ws.onclose = () => {
      if (!closed) setTimeout(connect, 3000);
    };
  }
  connect();

  return {
    stop: () => {
      closed = true;
      ws?.close();
      container.hidden = true;
      container.innerHTML = "";
    },
  };
}
