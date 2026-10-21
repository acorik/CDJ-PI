import express from "express";
import http from "node:http";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { config, isProduction } from "./config";
import { logger } from "./utils/logger";
import { obsClient } from "./obs/client";
import { apiLimiter } from "./middleware/security";
import { requireAuth } from "./auth/middleware";
import { authRouter } from "./routes/auth";
import { scenesRouter } from "./routes/scenes";
import { streamRouter } from "./routes/stream";
import { audioRouter } from "./routes/audio";
import { systemRouter } from "./routes/system";
import { createWsGateway } from "./ws/gateway";

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", config.CORS_ORIGIN],
      },
    },
    hsts: isProduction ? undefined : false,
  }),
);
app.use(cors({ origin: config.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use(apiLimiter);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/scenes", requireAuth, scenesRouter);
app.use("/stream", requireAuth, streamRouter);
app.use("/audio", requireAuth, audioRouter);
app.use("/system", requireAuth, systemRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "no encontrado" });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("error no controlado", { message: err.message });
  res.status(500).json({ error: "error interno" });
});

const server = http.createServer(app);
createWsGateway(server);

server.listen(config.PORT, () => {
  logger.info(`backend escuchando en :${config.PORT}`);
  obsClient.connect().catch(() => {
    logger.warn("arrancando sin conexión a OBS, reintentará solo");
  });
});

process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());
