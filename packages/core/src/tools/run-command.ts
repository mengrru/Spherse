import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { isPathInside } from "../utils/path-safety.js";
import { AccessDeniedError } from "../errors.js";

const MAX_OUTPUT = 100 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 1_800_000;

const RunCommandParams = Type.Object({
  command: Type.String({
    description:
      "The shell command to execute. Run via sh -c (unix) / PowerShell (windows). On Windows, generate PowerShell syntax ($env:VAR, | object pipeline, cmdlets); avoid PowerShell 7+-only operators like && / || so it also runs on Windows PowerShell 5.1.",
  }),
  cwd: Type.Optional(
    Type.String({
      description:
        "Working directory. Relative paths resolve against the project root; absolute paths and ~/ paths are allowed anywhere within the user's home directory. Defaults to the project root.",
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Number({
      description: `Max execution time in ms. Default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS} (30min). For long-running tasks (builds, installs, training), pass an explicit estimate instead of relying on the default.`,
    }),
  ),
});

export interface CommandCardDetails {
  cardType: "command";
  status: "running" | "completed" | "error";
  command: string;
  cwd?: string;
  stdout: string;
  stderr: string;
  exitCode?: number;
  durationMs?: number;
  timedOut?: boolean;
  aborted?: boolean;
}

export function clampTimeout(ms: number | undefined): number {
  const v = ms ?? DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(v), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

export function expandHome(input: string, home = os.homedir()): string {
  if (input === "~") return home;
  if (input.startsWith("~/") || input.startsWith("~\\")) return path.join(home, input.slice(2));
  return input;
}

export function resolveCommandCwd(projectRoot: string, input: string, home = os.homedir()): string {
  const expanded = expandHome(input, home);
  const resolved = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(projectRoot, expanded);
  if (!isPathInside(home, resolved) && !isPathInside(projectRoot, resolved)) {
    throw new AccessDeniedError(`cwd outside allowed roots (project root or user home): ${input}`);
  }
  return resolved;
}

export interface SpawnTarget {
  file: string;
  args: string[];
  detached: boolean;
}

export function buildSpawnTarget(command: string, cwd: string, platform: string, winShell: string): SpawnTarget {
  if (platform === "win32") {
    return {
      file: winShell,
      args: ["-NoProfile", "-NonInteractive", "-Command", command],
      detached: false,
    };
  }
  return {
    file: "/bin/sh",
    args: ["-c", command],
    detached: true,
  };
}

let cachedWinShell: string | undefined;

export function resolveWindowsShell(): string {
  if (cachedWinShell !== undefined) return cachedWinShell;
  for (const candidate of ["pwsh", "powershell"]) {
    try {
      const r = spawnSync(candidate, ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], {
        shell: false,
        timeout: 5000,
      });
      if (r.status === 0) {
        cachedWinShell = candidate;
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }
  // Windows PowerShell 5.1 is always present on supported Windows; safe fallback.
  cachedWinShell = "powershell";
  return cachedWinShell;
}

/** @internal reset cache — for tests only */
export function _resetWinShellCache(): void {
  cachedWinShell = undefined;
}

function killProcessTree(child: ChildProcess, platform: string): void {
  try {
    if (!child.pid) return;
    if (platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch {
    // process may have already exited
  }
}

export function createRunCommandTool(projectRoot: string): AgentTool<typeof RunCommandParams, CommandCardDetails> {
  const isWindows = process.platform === "win32";
  const shellHint = isWindows
    ? "This instance runs on Windows via PowerShell. Use PowerShell syntax ($env:VAR, | object pipeline, cmdlets); avoid PowerShell 7+-only operators (&& / ||) so commands also run on the built-in Windows PowerShell 5.1"
    : "This instance runs on a unix system via sh -c. Use POSIX shell syntax (bash-compatible: $VAR, | byte pipes, && / ||)";
  return {
    name: "run_command",
    label: "Run Command",
    description: `Execute a shell command and return its stdout/stderr/exit code. ${shellHint}. Requires explicit user approval before each execution — the proposed command is shown to the user who must approve it. The process runs with the user's full privileges (no OS sandbox); prefer project-relative paths and avoid destructive or network commands unless necessary.`,
    parameters: RunCommandParams,
    async execute(_toolCallId, params, signal, onUpdate) {
      const command = params.command;
      const cwdRel = params.cwd ?? ".";
      const timeoutMs = clampTimeout(params.timeout_ms);
      const cwd = resolveCommandCwd(projectRoot, cwdRel);
      const platform = process.platform;
      const winShell = platform === "win32" ? resolveWindowsShell() : "";
      const target = buildSpawnTarget(command, cwd, platform, winShell);

      if (signal?.aborted) {
        return abortedResult(command, cwdRel);
      }

      const startedAt = Date.now();
      let stdout = "";
      let stderr = "";
      let truncated = false;
      const emitUpdate = () => {
        onUpdate?.({
          content: [{ type: "text" as const, text: partialText(command, stdout, stderr) }],
          details: {
            cardType: "command",
            status: "running",
            command,
            cwd: cwdRel,
            stdout,
            stderr,
          } satisfies CommandCardDetails,
        });
      };

      return new Promise((resolve) => {
        let settled = false;
        const finish = (result: { stdout: string; stderr: string; exitCode?: number; timedOut?: boolean; aborted?: boolean; spawnError?: string }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          const durationMs = Date.now() - startedAt;
          const exitCode = result.exitCode;
          const isSpawnError = result.spawnError !== undefined;
          const isError = result.timedOut || result.aborted || isSpawnError || (exitCode !== undefined && exitCode !== 0);
          const details: CommandCardDetails = {
            cardType: "command",
            status: isError ? "error" : "completed",
            command,
            cwd: cwdRel,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode,
            durationMs,
            timedOut: result.timedOut,
            aborted: result.aborted,
          };
          const content = finalText(command, details, result.spawnError, truncated);
          resolve({ content: [{ type: "text" as const, text: content }], details });
        };

        const timer = setTimeout(() => {
          killProcessTree(child, platform);
          finish({ stdout, stderr, timedOut: true });
        }, timeoutMs);

        const onAbort = () => {
          killProcessTree(child, platform);
          finish({ stdout, stderr, aborted: true });
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        const appendStdout = (chunk: Buffer | string) => {
          if (stdout.length >= MAX_OUTPUT) {
            truncated = true;
            return;
          }
          stdout += chunk.toString("utf-8").slice(0, MAX_OUTPUT - stdout.length);
          emitUpdate();
        };
        const appendStderr = (chunk: Buffer | string) => {
          if (stderr.length >= MAX_OUTPUT) {
            truncated = true;
            return;
          }
          stderr += chunk.toString("utf-8").slice(0, MAX_OUTPUT - stderr.length);
          emitUpdate();
        };

        let child: ChildProcess;
        try {
          child = spawn(target.file, target.args, {
            cwd,
            env: process.env,
            detached: target.detached,
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (err) {
          finish({ stdout, stderr: stderr + (err as Error).message, spawnError: (err as Error).message });
          return;
        }

        child.stdout?.on("data", appendStdout);
        child.stderr?.on("data", appendStderr);
        child.on("error", (err) => {
          finish({ stdout, stderr: stderr + err.message, spawnError: err.message });
        });
        child.on("close", (code) => {
          finish({ stdout, stderr, exitCode: code ?? 0 });
        });
      });
    },
  };
}

function partialText(command: string, stdout: string, stderr: string): string {
  let text = `Command: ${command}\n--- stdout ---\n${stdout}`;
  if (stderr) text += `\n--- stderr ---\n${stderr}`;
  return text;
}

function finalText(
  command: string,
  details: CommandCardDetails,
  spawnError: string | undefined,
  truncated: boolean,
): string {
  const parts: string[] = [`Command: ${command}`];
  if (details.timedOut) {
    parts.push(`Exit code: (timed out after ${details.durationMs}ms)`);
  } else if (details.aborted) {
    parts.push(`Exit code: (aborted)`);
  } else if (spawnError) {
    parts.push(`Spawn error: ${spawnError}`);
  } else {
    parts.push(`Exit code: ${details.exitCode}`);
  }
  parts.push(`--- stdout ---`, details.stdout || "(empty)");
  if (truncated) parts.push("[output truncated]");
  if (details.stderr) parts.push(`--- stderr ---`, details.stderr);
  return parts.join("\n");
}

function abortedResult(command: string, cwdRel: string): { content: { type: "text"; text: string }[]; details: CommandCardDetails } {
  return {
    content: [{ type: "text" as const, text: `Command aborted before execution: ${command}` }],
    details: {
      cardType: "command",
      status: "error",
      command,
      cwd: cwdRel,
      stdout: "",
      stderr: "aborted before execution",
    },
  };
}
