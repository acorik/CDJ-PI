import type { Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { URL } from "node:url";
import { verifyAccessToken } from "../auth/jwt";
import { obsClient } from "../obs/client";
import { logger } from "../utils/logger";

const STATS_INTERVAL_MS = 5000;

export function createWsGateway(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/ws")) {
      socket.destroy();
      return;
    }

    const url = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token") ?? parseCookieToken(req.headers.cookie);

    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    try {
      verifyAccessToken(token);
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    logger.info("cliente WS conectado");
    ws.on("close", () => logger.info("cliente WS desconectado"));
  });

  const broadcast = (payload: unknown) => {
    const data = JSON.stringify(payload);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  };

  obsClient.on("scene-changed", (sceneName: string) => {
    broadcast({ type: "scene-changed", sceneName });
  });

  obsClient.on("stream-state", (data: unknown) => {
    broadcast({ type: "stream-state", data });
  });

  setInterval(() => {
    if (wss.clients.size === 0) return;
    broadcast({ type: "obs-connected", connected: obsClient.isConnected() });
  }, STATS_INTERVAL_MS);

  return wss;
}

function parseCookieToken(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const match = /access_token=([^;]+)/.exec(cookieHeader);
  return match?.[1];
}
