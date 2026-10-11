import { readFileSync } from "node:fs";
import { CliArgError, parseArgs } from "./args.js";
import { DEFAULT_FRONTEND_URL } from "./echo.js";
import { homePaths, initHome, resolveHome } from "./home.js";
import { createProjectDir, validateProjectName } from "./projects.js";

export const MIN_NODE_VERSION = "22.19.0";

export function checkNodeVersion(current: string): string | null {
  const parts = current.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return null;
  const [major, minor, patch] = parts;
  const [minMajor, minMinor, minPatch] = MIN_NODE_VERSION.split(".").map((part) => Number.parseInt(part, 10));
  const below =
    major < minMajor ||
    (major === minMajor && (minor < minMinor || (minor === minMinor && patch < minPatch)));
  if (!below) return null;
  return `Spherse requires Node.js >= ${MIN_NODE_VERSION}, but you are running ${current}. Please upgrade Node.js first (on Termux: pkg upgrade nodejs, or install a newer Node from your package manager).`;
}

export function readCliVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
    version: string;
  };
  return pkg.version;
}

const HELP = `spherse — self-hosted Spherse server from the terminal

Usage:
  spherse server [--port <n>] [--home <dir>] [--frontend-url <url>]
      Start the Spherse server on 127.0.0.1 (default port 53972).
      Prints the endpoint, the access token and a one-click login URL.

  spherse new <name> [--home <dir>]
      Create a project directory under <home>/projects/.
      It is registered the next time "spherse server" starts.

  spherse --version    Print the CLI version.
  spherse --help       Show this help.

Options:
  --port <n>           Listen port (default 53972; 0 = pick a free port).
  --home <dir>         Data directory (default: ~/.spherse, override: SPHERSE_HOME).
  --frontend-url <url> Web frontend base for the login URL (default: ${DEFAULT_FRONTEND_URL}).
`;

export async function runCli(argv: string[]): Promise<number> {
  const versionError = checkNodeVersion(process.versions.node);
  if (versionError) {
    console.error(versionError);
    return 1;
  }
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    const message = err instanceof CliArgError ? err.message : String(err);
    console.error(`Error: ${message}\n\nRun "spherse --help" for usage.`);
    return 1;
  }
  switch (args.command) {
    case "help":
      console.log(HELP);
      return 0;
    case "version":
      console.log(readCliVersion());
      return 0;
    case "new":
      return runNewCommand(args.name!, args.home);
    case "server":
      console.error('Error: command "server" is not available in this build.');
      return 1;
  }
}

function runNewCommand(name: string, homeFlag?: string): number {
  const paths = homePaths(resolveHome(homeFlag));
  initHome(paths);
  try {
    validateProjectName(name, paths.projectsDir);
    const project = createProjectDir(paths.projectsDir, name);
    console.log(`Created project directory: ${project.root}`);
    console.log('It will be initialized and registered the next time "spherse server" starts.');
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    return 1;
  }
}
