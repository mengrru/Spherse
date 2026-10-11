export type CliCommand = "server" | "new" | "help" | "version";

export interface ParsedArgs {
  command: CliCommand;
  name?: string;
  port?: number;
  home?: string;
  frontendUrl?: string;
}

export class CliArgError extends Error {}

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) return { command: "help" };
  const [head, ...rest] = argv;
  if (head === "--help" || head === "-h" || head === "help") {
    return { command: "help" };
  }
  if (head === "--version" || head === "-v") {
    return { command: "version" };
  }
  if (head === "server") {
    const positional: string[] = [];
    const flags = parseFlags(rest, new Set(["port", "home", "frontend-url"]), positional);
    if (positional.length > 0) {
      throw new CliArgError(`unexpected argument "${positional[0]}" — "server" takes no positional arguments`);
    }
    return { command: "server", ...flags };
  }
  if (head === "new") {
    const positional: string[] = [];
    const flags = parseFlags(rest, new Set(["home"]), positional);
    if (positional.length !== 1) {
      throw new CliArgError("new requires exactly one project name: spherse new <name>");
    }
    return { command: "new", name: positional[0], ...flags };
  }
  throw new CliArgError(`unknown command "${head}" — expected "server" or "new"`);
}

interface FlagValues {
  port?: number;
  home?: string;
  frontendUrl?: string;
}

function parseFlags(args: string[], allowed: Set<string>, positional: string[] = []): FlagValues {
  const result: FlagValues = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      i += 1;
      continue;
    }
    const eq = arg.indexOf("=");
    const name = (eq >= 0 ? arg.slice(2, eq) : arg.slice(2)).toLowerCase();
    if (!allowed.has(name)) {
      throw new CliArgError(`unknown option "${arg}"`);
    }
    let value: string;
    if (eq >= 0) {
      value = arg.slice(eq + 1);
    } else {
      const next = args[i + 1];
      if (next === undefined) {
        throw new CliArgError(`option --${name} requires a value`);
      }
      value = next;
      i += 1;
    }
    if (value === "") {
      throw new CliArgError(`option --${name} requires a value`);
    }
    if (name === "port") {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new CliArgError(`invalid --port "${value}" — expected an integer between 0 and 65535`);
      }
      result.port = port;
    } else if (name === "home") {
      result.home = value;
    } else {
      result.frontendUrl = value;
    }
    i += 1;
  }
  return result;
}
