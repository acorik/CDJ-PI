import { Router } from "express";
import { obsClient } from "../obs/client";
import { logger } from "../utils/logger";

export const scenesRouter = Router();

scenesRouter.get("/", async (_req, res) => {
  try {
    const scenes = await obsClient.listScenes();
    res.json({ scenes });
  } catch (err) {
    res.status(503).json({ error: "OBS no disponible", detail: (err as Error).message });
  }
});

scenesRouter.post("/:name/activate", async (req, res) => {
  try {
    await obsClient.setCurrentScene(req.params.name);
    logger.info("escena activada", { scene: req.params.name, by: req.user?.username });
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: "no se pudo cambiar de escena", detail: (err as Error).message });
  }
});
