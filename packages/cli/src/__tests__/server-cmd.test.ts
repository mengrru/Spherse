import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { homePaths } from "../home.js";
import { readLockfile } from "../lockfile.js";
import { ServerCmdError, startServer, type RunningServer } from "../server-cmd.js";
import { readCliVersion } from "../version.js";

const base = mkdtempSync(join(tmpdir(), "spherse-cli-servercmd-"));
const servers: RunningServer[] = [];
afterAll(async () => {
  await Promise.all(servers.map((server) => server.close().catch(() => undefined)));
  rmSync(base, { recursive: true, force: true });
});

async function withProjects(name: string, projects: string[]): Promise<string> {
  const home = join(base, name);
  const dir = homePaths(home).projectsDir;
  mkdirSync(dir, { recursive: true });
  for (const project of projects) mkdirSync(join(dir, project), { recursive: true });
  return home;
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, init);
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("startServer (assembly, no mocks)", () => {
  it("boots the server, registers projects and echoes connection info", async () => {
    const home = await withProjects("assembly-home", ["alpha", "beta"]);
    const running = await startServer({ homeFlag: home });
    servers.push(running);

    expect(running.port).toBeGreaterThan(0);
    expect(running.token).toMatch(/^[0-9a-f]{64}$/);
    expect(running.endpoint).toBe(`http://127.0.0.1:${running.port}`);
    expect(running.loginUrl).toContain(`#/?base=${encodeURIComponent(running.endpoint)}&token=${running.token}`);

    const health = await fetchJson(`${running.endpoint}/health`);
    expect(health.status).toBe(200);

    const info = (await fetchJson(`${running.endpoint}/api/connection/info`)) as {
      status: number;
      body: { authRequired: boolean; appVersion: string | null };
    };
    expect(info.status).toBe(200);
    expect(info.body.authRequired).toBe(true);
    expect(info.body.appVersion).toBe(readCliVersion());

    const unauthed = await fetchJson(`${running.endpoint}/api/projects`);
    expect(unauthed.status).toBe(401);

    const authed = (await fetchJson(`${running.endpoint}/api/projects`, {
      headers: { Authorization: `Bearer ${running.token}` },
    })) as { status: number; body: Array<{ name: string }> };
    expect(authed.status).toBe(200);
    expect(authed.body.map((p) => p.name).sort()).toEqual(["alpha", "beta"]);

    const lock = readLockfile(homePaths(home).lockfilePath);
    expect(lock?.pid).toBe(process.pid);
    expect(lock?.port).toBe(running.port);

    await running.close();
    expect(existsSync(homePaths(home).lockfilePath)).toBe(false);
    await expect(fetch(`${running.endpoint}/health`)).rejects.toThrow();
  });

  it("creates the default project when projects dir is empty", async () => {
    const home = await withProjects("default-home", []);
    const running = await startServer({ homeFlag: home });
    servers.push(running);

    const authed = (await fetchJson(`${running.endpoint}/api/projects`, {
      headers: { Authorization: `Bearer ${running.token}` },
    })) as { body: Array<{ name: string }> };
    expect(authed.body.map((p) => p.name)).toEqual(["default"]);
    expect(readdirSync(homePaths(home).projectsDir)).toEqual(["default"]);
  });

  it("rejects a second instance on the same home", async () => {
    const home = await withProjects("lock-home", ["only"]);
    const first = await startServer({ homeFlag: home });
    servers.push(first);
    await expect(startServer({ homeFlag: home })).rejects.toThrow(/already running/);
    await first.close();
    const restarted = await startServer({ homeFlag: home });
    servers.push(restarted);
  });

  it("rejects an explicitly taken port", async () => {
    const home = await withProjects("port-home", []);
    const blocker = net.createServer();
    await new Promise<void>((resolvePromise) => blocker.listen(0, "127.0.0.1", () => resolvePromise()));
    const address = blocker.address();
    const takenPort = typeof address === "object" && address ? address.port : 0;
    try {
      await expect(startServer({ homeFlag: home, port: takenPort })).rejects.toThrow(/already in use/);
    } finally {
      blocker.close();
    }
  });

  it("respects an explicit free port", async () => {
    const probeHome = await withProjects("port-probe-home", []);
    const probeServer = await startServer({ homeFlag: probeHome, port: 0 });
    const freedPort = probeServer.port;
    await probeServer.close();

    const home = await withProjects("port-ok-home", []);
    const running = await startServer({ homeFlag: home, port: freedPort });
    servers.push(running);
    expect(running.port).toBe(freedPort);
  });

  it("uses the provided frontend url in the login link", async () => {
    const home = await withProjects("frontend-home", []);
    const running = await startServer({ homeFlag: home, frontendUrl: "https://example.com/app/" });
    servers.push(running);
    expect(running.loginUrl.startsWith("https://example.com/app/#/?")).toBe(true);
  });

  it("registers every scanned project", async () => {
    const home = await withProjects("multi-home", ["good"]);
    mkdirSync(join(homePaths(home).projectsDir, "also-good"), { recursive: true });
    const running = await startServer({ homeFlag: home });
    servers.push(running);
    const authed = (await fetchJson(`${running.endpoint}/api/projects`, {
      headers: { Authorization: `Bearer ${running.token}` },
    })) as { body: Array<{ name: string }> };
    expect(authed.body.map((p) => p.name).sort()).toEqual(["also-good", "good"]);
  });
});

describe("ServerCmdError", () => {
  it("is exported for error classification", () => {
    expect(new ServerCmdError("x")).toBeInstanceOf(Error);
  });
});
