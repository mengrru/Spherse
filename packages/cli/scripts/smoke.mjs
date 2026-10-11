import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const cliDir = new URL(".", import.meta.url).pathname;
const bin = join(cliDir, "../bin/spherse.js");

function fail(message) {
  console.error(`smoke failed: ${message}`);
  process.exit(1);
}

const versionProc = spawn(process.execPath, [bin, "--version"], { stdio: ["ignore", "pipe", "inherit"] });
let versionOut = "";
versionProc.stdout.on("data", (chunk) => (versionOut += chunk));
const versionCode = await new Promise((resolvePromise) => versionProc.on("close", resolvePromise));
if (versionCode !== 0 || !/^\d+\.\d+\.\d+/.test(versionOut.trim())) {
  fail(`--version exited ${versionCode} with output "${versionOut.trim()}"`);
}

const home = mkdtempSync(join(tmpdir(), "spherse-cli-smoke-"));
const serverProc = spawn(process.execPath, [bin, "server", "--port", "0", "--home", home], {
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "";
serverProc.stdout.on("data", (chunk) => (stdout += chunk));
serverProc.stderr.on("data", (chunk) => process.stderr.write(chunk));

let endpoint = null;
let token = null;
for (let i = 0; i < 100; i += 1) {
  const endpointMatch = stdout.match(/Endpoint:\s+(http:\/\/127\.0\.0\.1:\d+)/);
  const tokenMatch = stdout.match(/Token:\s+([0-9a-f]{64})/);
  if (endpointMatch && tokenMatch) {
    endpoint = endpointMatch[1];
    token = tokenMatch[1];
    break;
  }
  await sleep(200);
}
if (!endpoint || !token) fail(`server did not echo endpoint/token within 20s. Output:\n${stdout}`);

async function get(path, headers = {}) {
  const res = await fetch(`${endpoint}${path}`, { headers });
  return { status: res.status, body: await res.text() };
}

const health = await get("/health");
if (health.status !== 200) fail(`/health returned ${health.status}`);

const info = await get("/api/connection/info");
if (info.status !== 200 || JSON.parse(info.body).authRequired !== true) {
  fail(`/api/connection/info returned ${info.status}: ${info.body}`);
}

const projects = await get("/api/projects", { Authorization: `Bearer ${token}` });
if (projects.status !== 200 || !projects.body.includes("default")) {
  fail(`/api/projects returned ${projects.status}: ${projects.body}`);
}
const projectId = JSON.parse(projects.body)[0]?.id;
if (!projectId) fail(`no project id in /api/projects response: ${projects.body}`);

const sdk = await get(`/api/projects/${projectId}/preview/__auth/${token}/__spherse-sdk.js`);
if (sdk.status !== 200 || sdk.body.length < 1000) {
  fail(`preview sdk route returned ${sdk.status} (len ${sdk.body.length}) — @spherse/sdk/source alias broken?`);
}

const lockfile = join(home, "server.lock");
if (!existsSync(lockfile)) fail("server.lock was not created");
const lock = JSON.parse(readFileSync(lockfile, "utf-8"));
if (lock.pid !== serverProc.pid) fail(`server.lock pid ${lock.pid} != ${serverProc.pid}`);

serverProc.kill("SIGTERM");
const exitCode = await new Promise((resolvePromise) => serverProc.on("close", resolvePromise));
if (exitCode !== 0) fail(`server exited with code ${exitCode} after SIGTERM`);
if (existsSync(lockfile)) fail("server.lock was not removed on shutdown");

rmSync(home, { recursive: true, force: true });
console.log("smoke passed");
