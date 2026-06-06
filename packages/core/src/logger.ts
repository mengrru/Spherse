import pino from "pino";

export type Logger = pino.Logger;

export function createDefaultLogger(): Logger {
  return pino({
    level: "debug",
    transport: {
      target: "pino-pretty",
      options: { colorize: true },
    },
  });
}
