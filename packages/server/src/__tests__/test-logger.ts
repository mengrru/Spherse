import pino from "pino";

export function createSilentLoggerForTests(): pino.Logger {
  return pino({ level: "silent" });
}
