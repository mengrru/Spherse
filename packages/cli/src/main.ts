import { CliArgError, parseArgs } from "./args.js";
import { DEFAULT_FRONTEND_URL } from "./echo.js";
import { homePaths, initHome, resolveHome } from "./home.js";
import { createProjectDir, validateProjectName } from "./projects.js";
import { runServerCommand } from "./server-cmd.js";
import { checkNodeVersion, readCliVersion } from "./version.js";

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
      return runServerCommand({ port: args.port, homeFlag: args.home, frontendUrl: args.frontendUrl });
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
