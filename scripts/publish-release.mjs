import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const stableKeys = ["spherse/win/x64/latest.yml", "spherse/win/arm64/latest.yml", "spherse/latest.json"];

function versionParts(version) {
  if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Invalid stable version: ${version}`);
  }
  return version.split(".").map(BigInt);
}

export async function discoverAssets(directory, version, historical = false) {
  versionParts(version);
  const names = (await readdir(directory)).filter((name) => /\.(dmg|exe|AppImage|deb)$/.test(name)).sort();
  for (const name of names) {
    const info = await stat(join(directory, name));
    if (!info.isFile() || info.size === 0) throw new Error(`Invalid installer: ${name}`);
  }
  const select = (candidates, required = true) => {
    const matches = names.filter((name) => candidates.includes(name));
    if (matches.length > 1 || (required && matches.length !== 1)) {
      throw new Error(`Expected one installer: ${candidates.join(" or ")}`);
    }
    return matches[0];
  };
  return {
    names,
    macArm64: select([`Spherse-${version}-arm64.dmg`]),
    macIntel: select([`Spherse-${version}-intel.dmg`]),
    winX64: select([`Spherse-Setup-${version}-x64.exe`, ...(historical ? [`Spherse.Setup.${version}.exe`] : [])]),
    winArm64: select([`Spherse-Setup-${version}-arm64.exe`], !historical),
    linux: select([`Spherse-${version}-x86_64.AppImage`, `Spherse-${version}-x64.AppImage`], !historical),
    deb: select([`Spherse-${version}-amd64.deb`, `Spherse-${version}-x64.deb`], !historical),
  };
}

async function installerIntegrity(path) {
  const hash = createHash("sha512");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha512: hash.digest("base64"), size };
}

export async function buildManifests({ directory, version, publicBaseUrl, assets, releaseDate = new Date().toISOString() }) {
  versionParts(version);
  const base = new URL(publicBaseUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    throw new Error("OSS_PUBLIC_BASE_URL must be an HTTPS base URL without credentials, query or fragment");
  }
  const url = (name) => `${base.href.replace(/\/$/, "")}/spherse/releases/${version}/${encodeURIComponent(name)}`;
  const latest = {
    version,
    mac: { arm64: url(assets.macArm64), intel: url(assets.macIntel) },
    win: { x64: url(assets.winX64) },
  };
  if (assets.winArm64) latest.win.arm64 = url(assets.winArm64);
  if (assets.linux) latest.linux = { x64: url(assets.linux) };
  const manifests = new Map();
  for (const [arch, name] of [["x64", assets.winX64], ["arm64", assets.winArm64]]) {
    if (!name) continue;
    const integrity = await installerIntegrity(join(directory, name));
    manifests.set(`spherse/win/${arch}/latest.yml`, `${JSON.stringify({
      version,
      files: [{ url: url(name), ...integrity }],
      releaseDate,
    }, null, 2)}\n`);
  }
  manifests.set("spherse/latest.json", `${JSON.stringify(latest, null, 2)}\n`);
  return manifests;
}

export async function assertStableVersion(version, store) {
  const target = versionParts(version);
  const metadata = new Map();
  for (const key of stableKeys) {
    const raw = await store.read(key);
    if (raw === null) continue;
    const manifest = JSON.parse(raw);
    const existing = versionParts(manifest.version);
    const difference = target.map((part, index) => part - existing[index]).find((part) => part !== 0n);
    if (difference < 0n) throw new Error(`Refusing stable downgrade: ${key} is newer than ${version}`);
    metadata.set(key, manifest);
  }
  return metadata;
}

export async function publishRelease({ directory, outputDirectory, version, historical = false, publicBaseUrl, store }) {
  const assets = await discoverAssets(directory, version, historical);
  const metadata = await assertStableVersion(version, store);
  for (const [key, manifest] of metadata) {
    if (!key.endsWith(".yml") || manifest.version !== version) continue;
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
      throw new Error(`Invalid existing feed: ${key}`);
    }
    for (const file of manifest.files) {
      const name = assets.names.find((name) => name.endsWith(".exe") &&
        file?.url === `${new URL(publicBaseUrl).href.replace(/\/$/, "")}/spherse/releases/${version}/${encodeURIComponent(name)}`);
      if (!name) throw new Error(`Missing candidate for existing feed: ${key}`);
      const integrity = await installerIntegrity(join(directory, name));
      if (file.sha512 !== integrity.sha512 || file.size !== integrity.size) {
        throw new Error(`Refusing changed installer for existing feed: ${key}`);
      }
    }
  }
  for (const name of assets.names) {
    await store.upload(join(directory, name), `spherse/releases/${version}/${name}`);
  }
  const manifests = await buildManifests({ directory, version, publicBaseUrl, assets });
  for (const [key, content] of manifests) {
    const path = join(outputDirectory, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  for (const key of manifests.keys()) {
    await store.upload(join(outputDirectory, key), key);
  }
}

export function createOssStore(env, run = execFileSync) {
  for (const name of ["OSS_BUCKET", "OSS_ENDPOINT", "OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET"]) {
    if (!env[name]) throw new Error(`${name} is required`);
  }
  const auth = ["-e", env.OSS_ENDPOINT, "-i", env.OSS_ACCESS_KEY_ID, "-k", env.OSS_ACCESS_KEY_SECRET];
  const execute = (args) => run("/tmp/ossutil", [...args, ...auth], {
    encoding: "utf8", stdio: "pipe", maxBuffer: 4 * 1024 * 1024,
  });
  return {
    async read(key) {
      try {
        const output = execute(["cat", `oss://${env.OSS_BUCKET}/${key}`]);
        return output.replace(/\r?\n\d+\.\d{6}\(s\) elapsed\r?\n$/, "");
      } catch (error) {
        const diagnostic = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
        if (error.status === 1 && /\bStatusCode=404, ErrorCode=NoSuchKey,/.test(diagnostic)) return null;
        throw new Error(`Cannot read stable metadata: ${key}`);
      }
    },
    async upload(path, key) {
      try {
        execute(["cp", path, `oss://${env.OSS_BUCKET}/${key}`, "--force"]);
      } catch {
        throw new Error(`Cannot upload: ${key}`);
      }
    },
  };
}

export function usesHistoricalAssets(env) {
  return env.GITHUB_EVENT_NAME === "workflow_dispatch" && env.HISTORICAL_ASSETS === "true";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = await mkdtemp(join(tmpdir(), "spherse-manifests-"));
  try {
    if (!["push", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME)) throw new Error("Unsupported release event");
    await publishRelease({
      directory: "./oss-out",
      outputDirectory: directory,
      version: process.env.RELEASE_TAG?.replace(/^v/, ""),
      historical: usesHistoricalAssets(process.env),
      publicBaseUrl: process.env.OSS_PUBLIC_BASE_URL,
      store: createOssStore(process.env),
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
