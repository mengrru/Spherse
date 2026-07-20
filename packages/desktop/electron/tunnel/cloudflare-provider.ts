import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { app } from "electron";
import type { TunnelProvider, TunnelSession } from "./provider.js";

const URL_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const STARTUP_TIMEOUT_MS = 30_000;

function resolveCloudflaredBinary(): string {
  const platform = process.platform;
  const arch = process.arch;
  const exeName = platform === "win32" ? "cloudflared.exe" : "cloudflared";

  if (app.isPackaged) {
    const platformDirs: Record<string, string> = {
      darwin: arch === "arm64" ? "darwin-arm64" : "darwin-amd64",
      win32: arch === "arm64" ? "windows-arm64" : "windows-amd64",
      linux: arch === "arm64" ? "linux-arm64" : "linux-amd64",
    };
    const dir = platformDirs[platform];
    if (dir) {
      const candidate = path.join(process.resourcesPath, "cloudflared", dir, exeName);
      if (fs.existsSync(candidate)) return candidate;
    }

    for (const candidate of bundledBinaryCandidates(platform, exeName)) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return exeName;
}

function bundledBinaryCandidates(platform: NodeJS.Platform, exeName: string): string[] {
  if (platform === "darwin") {
    return [
      "/opt/homebrew/bin/cloudflared",
      "/usr/local/bin/cloudflared",
      `${process.env.HOME ?? ""}/.local/bin/cloudflared`,
    ];
  }
  if (platform === "win32") {
    return [
      `${process.env.PROGRAMFILES ?? "C:\\Program Files"}\\cloudflared\\${exeName}`,
      `${process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"}\\cloudflared\\${exeName}`,
      `${process.env.LOCALAPPDATA ?? ""}\\Microsoft\\WinGet\\Links\\${exeName}`,
    ];
  }
  if (platform === "linux") {
    return [
      "/usr/local/bin/cloudflared",
      "/usr/bin/cloudflared",
      `${process.env.HOME ?? ""}/.local/bin/cloudflared`,
      "/snap/bin/cloudflared",
    ];
  }
  return [];
}

function buildSpawnEnv(): NodeJS.ProcessEnv {
  const extraPaths: string[] = [];
  if (process.platform === "darwin") {
    extraPaths.push("/opt/homebrew/bin", "/usr/local/bin");
  } else if (process.platform === "linux") {
    extraPaths.push("/usr/local/bin", "/usr/local/sbin", "/snap/bin");
  }
  if (extraPaths.length === 0) return process.env;
  const pathSep = process.platform === "win32" ? ";" : ":";
  const existingPath = process.env.PATH ?? "";
  return { ...process.env, PATH: `${existingPath}${pathSep}${extraPaths.join(pathSep)}` };
}

interface CloudflareSessionOptions {
  process: ChildProcess;
  publicUrl: string;
  startedAt: string;
}

class CloudflareTunnelSession implements TunnelSession {
  readonly publicUrl: string;
  readonly startedAt: string;
  private readonly proc: ChildProcess;
  private readonly stopListeners = new Set<() => void>();
  private stopped = false;

  constructor(opts: CloudflareSessionOptions) {
    this.proc = opts.process;
    this.publicUrl = opts.publicUrl;
    this.startedAt = opts.startedAt;
    this.proc.on("exit", () => this.notifyStop());
    this.proc.on("error", () => this.notifyStop());
  }

  onStop(fn: () => void): void {
    this.stopListeners.add(fn);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    try { this.proc.kill("SIGTERM"); } catch { /* already exited */ }
    const onExit = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try { this.proc.kill("SIGKILL"); } catch { /* ignore */ }
        resolve();
      }, 3000);
      this.proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await onExit;
    this.notifyStop();
  }

  private notifyStop(): void {
    if (this.stopListeners.size === 0) return;
    for (const fn of this.stopListeners) {
      try { fn(); } catch { /* listener error */ }
    }
    this.stopListeners.clear();
  }
}

export class CloudflareTunnelProvider implements TunnelProvider {
  readonly id = "cloudflare";

  async start(localPort: number): Promise<TunnelSession> {
    const binary = resolveCloudflaredBinary();
    const child = spawn(binary, [
      "tunnel",
      "--no-autoupdate",
      "--url", `http://localhost:${localPort}`,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      env: buildSpawnEnv(),
    });

    let settled = false;
    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch { /* already exited */ }
    };

    const publicUrl = await new Promise<string>((resolve, reject) => {
      const startupTimer = setTimeout(() => {
        cleanup();
        reject(new Error("cloudflared startup timeout"));
      }, STARTUP_TIMEOUT_MS);

      const handleData = (chunk: Buffer): void => {
        const text = chunk.toString();
        const match = URL_REGEX.exec(text);
        if (match) {
          clearTimeout(startupTimer);
          settled = true;
          child.stdout?.off("data", handleData);
          child.stderr?.off("data", handleData);
          resolve(match[0]);
        }
      };

      child.stdout?.on("data", handleData);
      child.stderr?.on("data", handleData);

      child.once("error", (err) => {
        clearTimeout(startupTimer);
        cleanup();
        const message = (err as NodeJS.ErrnoException).code === "ENOENT"
          ? `cloudflared not found. Please install it (e.g. brew install cloudflared on macOS, scoop install cloudflared on Windows) and retry. Original error: ${err.message}`
          : `cloudflared failed to start: ${err.message}`;
        reject(new Error(message));
      });

      child.once("exit", (code) => {
        if (settled) return;
        clearTimeout(startupTimer);
        cleanup();
        reject(new Error(`cloudflared exited before handshake (code=${code})`));
      });
    });

    return new CloudflareTunnelSession({
      process: child,
      publicUrl,
      startedAt: new Date().toISOString(),
    });
  }
}
