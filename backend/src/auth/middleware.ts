import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "./jwt";

declare module "express-serve-static-core" {
  interface Request {
    user?: { username: string };
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const token = bearer ?? req.cookies?.access_token;

  if (!token) {
    res.status(401).json({ error: "no autenticado" });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { username: payload.sub };
    next();
  } catch {
    res.status(401).json({ error: "token inválido o expirado" });
  }
}
