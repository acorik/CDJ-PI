// Overlay de chat opcional: lee el chat público de Twitch de forma anónima
// (sin login, sin token) vía el gateway IRC-sobre-WebSocket, y lo dibuja
// como texto simple sobre el canvas. Nada de librerías de IRC: son ~15
// líneas de protocolo y no vale la pena una dependencia para esto.

export interface ChatOverlay {
  stop: () => void;
  drawOnto: (ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) => void;
}

const MAX_LINES = 6;

export function startChatOverlay(channel: string): ChatOverlay {
  const lines: string[] = [];
  let ws: WebSocket | null = null;
  let closed = false;

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
        if (match) {
          lines.push(`${match[1]}: ${match[2]}`);
          if (lines.length > MAX_LINES) lines.shift();
        }
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
    },
    drawOnto: (ctx, canvasWidth, canvasHeight) => {
      if (lines.length === 0) return;
      ctx.save();
      ctx.font = "16px system-ui, sans-serif";
      const lineHeight = 22;
      const boxHeight = lines.length * lineHeight + 12;
      const boxWidth = Math.min(420, canvasWidth * 0.35);
      const x = 16;
      const y = canvasHeight - boxHeight - 16;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(x, y, boxWidth, boxHeight);
      ctx.fillStyle = "#fff";
      lines.forEach((line, i) => {
        const text = line.length > 60 ? line.slice(0, 57) + "..." : line;
        ctx.fillText(text, x + 10, y + 20 + i * lineHeight);
      });
      ctx.restore();
    },
  };
}
