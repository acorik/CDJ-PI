import jwt from "jsonwebtoken";
import { config } from "../config";

export interface AccessTokenPayload {
  sub: string;
  type: "access";
}

export interface RefreshTokenPayload {
  sub: string;
  type: "refresh";
}

const ACCESS_TTL = "15m";
const REFRESH_TTL = "7d";

export function signAccessToken(username: string): string {
  return jwt.sign({ sub: username, type: "access" } satisfies AccessTokenPayload, config.JWT_SECRET, {
    expiresIn: ACCESS_TTL,
  });
}

export function signRefreshToken(username: string): string {
  return jwt.sign({ sub: username, type: "refresh" } satisfies RefreshTokenPayload, config.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TTL,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, config.JWT_SECRET) as AccessTokenPayload;
  if (payload.type !== "access") throw new Error("token type inválido");
  return payload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const payload = jwt.verify(token, config.JWT_REFRESH_SECRET) as RefreshTokenPayload;
  if (payload.type !== "refresh") throw new Error("token type inválido");
  return payload;
}
