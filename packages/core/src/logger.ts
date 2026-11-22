export interface LogFn {
  (obj: object, msg?: string, ...args: unknown[]): void;
  (msg: string, ...args: unknown[]): void;
}

export interface Logger {
  level: string;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  debug: LogFn;
  trace: LogFn;
  fatal: LogFn;
  child(bindings: Record<string, unknown>): Logger;
}

const noop: LogFn = () => undefined;

export const SILENT_LOG_LEVEL = "silent";

export function createSilentLogger(): Logger {
  const logger: Logger = {
    level: SILENT_LOG_LEVEL,
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => logger,
  };
  return logger;
}
