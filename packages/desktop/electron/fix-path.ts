import { spawn } from "node:child_process";
import { app } from "electron";

const TIMEOUT_MS = 3000;
// eslint-disable-next-line no-control-regex
const ANSI_OR_CONTROL = /\x1b\[[0-9;?]*[a-zA-Z]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

export function parseShellPathOutput(raw: string): string[] {
  const lines = raw.split("\n");
  let last = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed) {
      last = trimmed;
      break;
    }
  }
  if (!last) return [];
  const cleaned = last.replace(ANSI_OR_CONTROL, "");
  return cleaned
    .split(":")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function mergePath(shellEntries: string[], currentPath: string | undefined): string {
  const current = (currentPath ?? "")
    .split(":")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of [...shellEntries, ...current]) {
    if (!seen.has(entry)) {
      seen.add(entry);
      out.push(entry);
    }
  }
  return out.join(":");
}

function resolveShell(): string | null {
  if (process.env.SHELL && process.env.SHELL.trim()) return process.env.SHELL;
  if (process.platform === "darwin") return "/bin/zsh";
  if (process.platform === "linux") return "/bin/bash";
  return null;
}

function runShellPath(shell: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(shell, ["-lic", "echo $PATH"], {
      env: { ...process.env, TERM: "dumb" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimer();
      reject(err);
    });
    child.on("close", () => {
      clearTimer();
      resolve(stdout);
    });
    timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // best-effort kill
      }
      reject(new Error(`shell timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

export async function fixPath(): Promise<void> {
  if (!app.isPackaged) return;
  if (process.platform !== "darwin" && process.platform !== "linux") return;
  const shell = resolveShell();
  if (!shell) return;

  try {
    const stdout = await runShellPath(shell, TIMEOUT_MS);
    const entries = parseShellPathOutput(stdout);
    if (entries.length === 0) return;
    process.env.PATH = mergePath(entries, process.env.PATH);
  } catch (err) {
    console.warn("[fix-path] failed to resolve shell PATH, keeping existing:", err);
  }
}
