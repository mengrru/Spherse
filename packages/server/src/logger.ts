import pino from "pino";
import type { Logger } from "@spherse/core";
import { createDebugStream } from "./ws-debug.js";

export function createServerLogger(): Logger {
  const pretty = pino.transport({
    target: "pino-pretty",
    options: { colorize: true },
  });
  pretty.on("error", () => {});

  const debugStream = createDebugStream();
  return pino({ level: "debug" }, pino.multistream([pretty, debugStream]));
}

export function createFastifyLoggerStream() {
  const transport = pino.transport({
    target: "pino-pretty",
    options: { colorize: true },
  });
  transport.on("error", () => {});
  return transport;
}
