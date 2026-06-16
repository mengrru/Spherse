import pino from "pino";
import type { Logger } from "@spherse/core";
import { createDebugStream } from "./ws-debug.js";

export type PrettyStream = ReturnType<typeof pino.transport>;

export function createPrettyStream(): PrettyStream {
  const transport = pino.transport({
    target: "pino-pretty",
    options: { colorize: true },
  });
  transport.on("error", () => {});
  return transport;
}

export function createServerLogger(prettyStream: PrettyStream): Logger {
  const debugStream = createDebugStream();
  return pino({ level: "debug" }, pino.multistream([prettyStream, debugStream]));
}
