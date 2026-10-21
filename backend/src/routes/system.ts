import { Router } from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";

const execFileAsync = promisify(execFile);

export const systemRouter = Router();

async function readTemperature(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("vcgencmd", ["measure_temp"]);
    const match = /temp=([\d.]+)/.exec(stdout);
    return match ? parseFloat(match[1]) : null;
  } catch {
    return null;
  }
}

async function readThrottled(): Promise<{ throttled: boolean; raw: string | null }> {
  try {
    const { stdout } = await execFileAsync("vcgencmd", ["get_throttled"]);
    const raw = stdout.trim();
    const match = /0x([0-9a-f]+)/.exec(raw);
    const value = match ? parseInt(match[1], 16) : 0;
    return { throttled: value !== 0, raw };
  } catch {
    return { throttled: false, raw: null };
  }
}

systemRouter.get("/stats", async (_req, res) => {
  const [temperatureC, throttled] = await Promise.all([readTemperature(), readThrottled()]);
  res.json({
    temperatureC,
    throttled,
    loadavg: os.loadavg(),
    uptimeSeconds: os.uptime(),
    freeMemBytes: os.freemem(),
    totalMemBytes: os.totalmem(),
  });
});
