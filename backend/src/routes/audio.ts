import { Router } from "express";
import { z } from "zod";
import { obsClient } from "../obs/client";
import { logger } from "../utils/logger";

export const audioRouter = Router();

audioRouter.get("/sources", async (_req, res) => {
  try {
    const sources = await obsClient.listAudioSources();
    res.json({ sources });
  } catch (err) {
    res.status(503).json({ error: "OBS no disponible", detail: (err as Error).message });
  }
});

const muteSchema = z.object({ muted: z.boolean() });

audioRouter.post("/:source/mute", async (req, res) => {
  const parsed = muteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "body debe ser { muted: boolean }" });
    return;
  }
  try {
    await obsClient.setMute(req.params.source, parsed.data.muted);
    logger.info("mute cambiado", { source: req.params.source, muted: parsed.data.muted, by: req.user?.username });
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: "no se pudo cambiar el mute", detail: (err as Error).message });
  }
});

const volumeSchema = z.object({ volumeDb: z.number().min(-100).max(26) });

audioRouter.post("/:source/volume", async (req, res) => {
  const parsed = volumeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "body debe ser { volumeDb: number entre -100 y 26 }" });
    return;
  }
  try {
    await obsClient.setVolumeDb(req.params.source, parsed.data.volumeDb);
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: "no se pudo cambiar el volumen", detail: (err as Error).message });
  }
});
