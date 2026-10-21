import winston from "winston";
import { isProduction } from "../config";

const REDACT_KEYS = ["password", "token", "jwt", "secret", "authorization", "cookie"];

const redactFormat = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (REDACT_KEYS.some((k) => key.toLowerCase().includes(k))) {
      info[key] = "[redacted]";
    }
  }
  return info;
});

export const logger = winston.createLogger({
  level: isProduction ? "info" : "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    redactFormat(),
    isProduction ? winston.format.json() : winston.format.simple(),
  ),
  transports: [new winston.transports.Console()],
});
