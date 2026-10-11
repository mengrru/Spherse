import net from "node:net";
import { createMultiProjectServer, type MultiProjectServer } from "@spherse/server";
import { DEFAULT_FRONTEND_URL, buildLoginUrl, renderStartupMessage } from "./echo.js";
import { homePaths, initHome, resolveHome } from "./home.js";
import { acquireLockfile, removeLockfile, writeLockfile } from "./lockfile.js";
import { ensureDefaultProject, scanProjects } from "./projects.js";
import { ensureServerToken } from "./settings-store.js";
import { readCliVersion } from "./version.js";

export class ServerCmdError extends Error {}

export interface ServerCmdOptions {
  port?: number;
  homeFlag?: string;
  frontendUrl?: string;
}

export interface RunningServer {
  port: number;
  endpoint: string;
  token: string;
  loginUrl: string;
  close: () => Promise<void>;
}

export async function startServer(options: ServerCmdOptions): Promise<RunningServer> {
  const paths = homePaths(resolveHome(options.homeFlag));
  initHome(paths);

  const acquisition = acquireLockfile(paths.lockfilePath);
  if (!acquisition.ok) {
    const heldBy = acquisition.heldBy;
    const where = heldBy && heldBy.port > 0 ? ` at http://127.0.0.1:${heldBy.port}` : "";
    const pid = heldBy ? ` (pid ${heldBy.pid})` : "";
    throw new ServerCmdError(`another Spherse server is already running${pid}${where} — home: ${paths.home}`);
  }

  try {
    return await bootServer(options, paths);
  } catch (err) {
    removeLockfile(paths.lockfilePath);
    throw err;
  }
}

async function bootServer(options: ServerCmdOptions, paths: ReturnType<typeof homePaths>): Promise<RunningServer> {
  const token = ensureServerToken(paths.settingsPath);

  if (options.port !== undefined && options.port !== 0) {
    await assertPortAvailable(options.port);
  }

  const server: MultiProjectServer = await createMultiProjectServer({
    auth: { accessToken: token },
    modelSettingsPath: paths.modelSettingsPath,
    appVersion: readCliVersion(),
    port: options.port,
  });

  const port = readActualPort(server);
  if (options.port !== undefined && options.port !== 0 && port !== options.port) {
    await server.close({ stageTimeoutMs: 10_000 });
    throw new ServerCmdError(`port ${options.port} was taken during startup — refusing to continue`);
  }

  await registerProjects(paths.projectsDir, server);

  writeLockfile(paths.lockfilePath, { pid: process.pid, port, startedAt: new Date().toISOString() });

  const endpoint = `http://127.0.0.1:${port}`;
  const frontendUrl = options.frontendUrl ?? DEFAULT_FRONTEND_URL;
  const loginUrl = buildLoginUrl({ frontendUrl, baseUrl: endpoint, token });

  return {
    port,
    endpoint,
    token,
    loginUrl,
    close: () => closeServer(server, paths.lockfilePath),
  };
}

async function closeServer(server: MultiProjectServer, lockfilePath: string): Promise<void> {
  await server.close({ stageTimeoutMs: 10_000 });
  removeLockfile(lockfilePath);
}

export async function runServerCommand(options: ServerCmdOptions): Promise<number> {
  let running: RunningServer;
  try {
    running = await startServer(options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    return 1;
  }
  console.log(renderStartupMessage(running));
  const shutdown = (signal: string) => {
    void running
      .close()
      .catch((err: unknown) => {
        console.error(`Error during shutdown:`, err);
      })
      .then(() => {
        console.log(`\nSpherse server stopped (${signal}).`);
        process.exit(0);
      });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  await new Promise<void>(() => {});
  return 0;
}

function readActualPort(server: MultiProjectServer): number {
  const address = server.fastify.server.address();
  if (typeof address !== "object" || address === null) {
    throw new ServerCmdError("server is not listening on an inet socket");
  }
  return address.port;
}

async function registerProjects(projectsDir: string, server: MultiProjectServer): Promise<void> {
  const created = ensureDefaultProject(projectsDir);
  if (created) {
    console.log(`Created default project at ${created.root}`);
  }
  for (const project of scanProjects(projectsDir)) {
    try {
      await server.registry.register(project.root);
    } catch (err) {
      console.error(`Failed to register project at ${project.root}:`, err);
    }
  }
}

function assertPortAvailable(port: number): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const probe = net.createServer();
    probe.once("error", () => {
      rejectPromise(new ServerCmdError(`port ${port} is already in use — choose a different port via --port <n>`));
    });
    probe.once("listening", () => {
      probe.close(() => resolvePromise());
    });
    probe.listen(port, "127.0.0.1");
  });
}
