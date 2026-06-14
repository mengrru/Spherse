import pino from "pino";

export type Logger = pino.Logger;

export function createSilentLogger(): Logger {
  return pino({ level: "silent" });
}
