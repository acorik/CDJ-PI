import { Router } from "express";
import { obsClient } from "../obs/client";
import { logger } from "../utils/logger";

export const streamRouter = Router();

streamRouter.get("/status", async (_req, res) => {
  try {
    const status = await obsClient.getStreamStatus();
    res.json(status);
  } catch (err) {
    res.status(503).json({ error: "OBS no disponible", detail: (err as Error).message });
  }
});

streamRouter.post("/start", async (req, res) => {
  try {
    await obsClient.startStream();
    logger.info("stream iniciado", { by: req.user?.username });
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: "no se pudo iniciar el stream", detail: (err as Error).message });
  }
});

streamRouter.post("/stop", async (req, res) => {
  try {
    await obsClient.stopStream();
    logger.info("stream detenido", { by: req.user?.username });
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: "no se pudo detener el stream", detail: (err as Error).message });
  }
});
