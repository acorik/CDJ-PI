import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET debe tener al menos 32 caracteres"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET debe tener al menos 32 caracteres"),
  ADMIN_USERNAME: z.string().min(1),
  ADMIN_PASSWORD_HASH: z.string().min(1, "falta ADMIN_PASSWORD_HASH (bcrypt hash, no texto plano)"),
  OBS_WS_URL: z.string().url().default("ws://127.0.0.1:4455"),
  OBS_WS_PASSWORD: z.string().optional().default(""),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Configuración inválida en .env:\n", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

if (parsed.data.JWT_SECRET === parsed.data.JWT_REFRESH_SECRET) {
  // eslint-disable-next-line no-console
  console.error("JWT_SECRET y JWT_REFRESH_SECRET deben ser distintos.");
  process.exit(1);
}

export const config = parsed.data;
export const isProduction = config.NODE_ENV === "production";
