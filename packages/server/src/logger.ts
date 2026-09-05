import pino from "pino";
import type { Logger } from "@spherse/core";
import { createDebugBusStream } from "./lib/debug-sink.js";

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
  const debugStream = createDebugBusStream();
  return pino({ level: "debug" }, pino.multistream([prettyStream, debugStream]));
}
