import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { config } from "../config";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../auth/jwt";
import { loginLimiter, cookieOptions } from "../middleware/security";
import { logger } from "../utils/logger";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "username y password requeridos" });
    return;
  }

  const { username, password } = parsed.data;

  const validUsername = username === config.ADMIN_USERNAME;
  const validPassword = await bcrypt.compare(password, config.ADMIN_PASSWORD_HASH);

  if (!validUsername || !validPassword) {
    logger.warn("login fallido", { username, ip: req.ip });
    res.status(401).json({ error: "credenciales inválidas" });
    return;
  }

  const accessToken = signAccessToken(username);
  const refreshToken = signRefreshToken(username);

  res.cookie("access_token", accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
  res.cookie("refresh_token", refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
  logger.info("login correcto", { username });
  res.json({ ok: true });
});

authRouter.post("/refresh", (req, res) => {
  const token = req.cookies?.refresh_token;
  if (!token) {
    res.status(401).json({ error: "no hay sesión" });
    return;
  }

  try {
    const payload = verifyRefreshToken(token);
    const accessToken = signAccessToken(payload.sub);
    res.cookie("access_token", accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
    res.json({ ok: true });
  } catch {
    res.status(401).json({ error: "refresh token inválido o expirado" });
  }
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("access_token", cookieOptions);
  res.clearCookie("refresh_token", cookieOptions);
  res.json({ ok: true });
});
