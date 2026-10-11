import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface LockfileData {
  pid: number;
  port: number;
  startedAt: string;
}

export function readLockfile(lockfilePath: string): LockfileData | null {
  try {
    const parsed = JSON.parse(readFileSync(lockfilePath, "utf-8")) as Partial<LockfileData>;
    if (
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      typeof parsed.port === "number" &&
      typeof parsed.startedAt === "string"
    ) {
      return { pid: parsed.pid, port: parsed.port, startedAt: parsed.startedAt };
    }
    return null;
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function findRunningInstance(lockfilePath: string): LockfileData | null {
  const data = readLockfile(lockfilePath);
  if (!data) return null;
  return isProcessAlive(data.pid) ? data : null;
}

export function writeLockfile(lockfilePath: string, data: LockfileData): void {
  mkdirSync(dirname(lockfilePath), { recursive: true });
  const tmp = `${lockfilePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, lockfilePath);
}

export function removeLockfile(lockfilePath: string): void {
  rmSync(lockfilePath, { force: true });
}
