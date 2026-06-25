import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { llmAccessPolicy, type AccessPolicy } from "../access/access-policy.js";

export function permissivePolicy(projectRoot: string): () => AccessPolicy {
  return () => llmAccessPolicy(projectRoot, []);
}

export async function createTempProject(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wb-test-"));
  return tmpDir;
}

export async function cleanupDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

export async function writeFile(dir: string, relativePath: string, content: string): Promise<void> {
  const fullPath = path.join(dir, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
}

export async function readFile(dir: string, relativePath: string): Promise<string> {
  return fs.readFile(path.join(dir, relativePath), "utf-8");
}

export async function ensureDir(dir: string, relativePath: string): Promise<void> {
  await fs.mkdir(path.join(dir, relativePath), { recursive: true });
}

export function pathExists(dir: string, relativePath: string): boolean {
  return fsSync.existsSync(path.join(dir, relativePath));
}
