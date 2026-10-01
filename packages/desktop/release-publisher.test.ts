import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GenericProvider } from "electron-updater/out/providers/GenericProvider.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertStableVersion, buildManifests, createOssStore, discoverAssets, publishRelease, usesHistoricalAssets } from "../../scripts/publish-release.mjs";

const stableKeys = ["spherse/win/x64/latest.yml", "spherse/win/arm64/latest.yml", "spherse/latest.json"];
const publicBaseUrl = "https://downloads.example.com";
const roots: string[] = [];

async function fixture(version = "0.5.1", names = [
  `Spherse-${version}-arm64.dmg`, `Spherse-${version}-intel.dmg`,
  `Spherse-Setup-${version}-x64.exe`, `Spherse-Setup-${version}-arm64.exe`,
  `Spherse-${version}-x86_64.AppImage`, `Spherse-${version}-amd64.deb`,
]) {
  const root = await mkdtemp(join(tmpdir(), "spherse-release-test-"));
  roots.push(root);
  const directory = join(root, "assets");
  const outputDirectory = join(root, "manifests");
  await mkdir(directory);
  for (const name of names) await writeFile(join(directory, name), Buffer.from(`${name}\0installer bytes\xff`));
  const uploaded = new Map<string, Buffer>();
  const store = {
    read: vi.fn(async (_key: string): Promise<string | null> => null),
    upload: vi.fn(async (path: string, key: string) => { uploaded.set(key, await readFile(path)); }),
  };
  return { directory, outputDirectory, version, publicBaseUrl, store, uploaded, names };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("release manifests and publication", () => {
  it("uploads every installer before generating any manifest, prepares all manifests before publishing, JSON last", async () => {
    const f = await fixture();
    const upload = f.store.upload.getMockImplementation()!;
    f.store.upload.mockImplementation(async (path, key) => {
      expect(f.store.read.mock.calls.map(([key]) => key)).toEqual(stableKeys);
      if (key.includes("/releases/")) {
        expect(existsSync(f.outputDirectory)).toBe(false);
      } else {
        expect([...f.uploaded.keys()].filter((key) => key.includes("/releases/"))).toHaveLength(f.names.length);
        for (const stableKey of stableKeys) expect(existsSync(join(f.outputDirectory, stableKey))).toBe(true);
      }
      await upload(path, key);
    });
    await publishRelease(f);
    expect([...f.uploaded.keys()]).toEqual([
      ...f.names.toSorted().map((name) => `spherse/releases/0.5.1/${name}`), ...stableKeys,
    ]);
    const url = (name: string) => `${publicBaseUrl}/spherse/releases/0.5.1/${name}`;
    expect(JSON.parse(f.uploaded.get("spherse/latest.json")!.toString())).toEqual({
      version: "0.5.1",
      mac: { arm64: url(f.names[0]), intel: url(f.names[1]) },
      win: { x64: url(f.names[2]), arm64: url(f.names[3]) },
      linux: { x64: url(f.names[4]) },
    });
    for (const arch of ["x64", "arm64"]) {
      const request = vi.fn(async () => f.uploaded.get(`spherse/win/${arch}/latest.yml`)!.toString());
      const provider = new GenericProvider(
        { provider: "generic", url: `${publicBaseUrl}/spherse/win/${arch}/` },
        { channel: null, isAddNoCacheQuery: false } as any,
        { platform: "win32", executor: { request } } as any,
      );
      const info = await provider.getLatestVersion();
      expect(request.mock.calls[0][0].path).toBe(`/spherse/win/${arch}/latest.yml`);
      expect(info.version).toBe("0.5.1");
      expect(Number.isNaN(Date.parse(info.releaseDate))).toBe(false);
      const resolved = provider.resolveFiles(info);
      expect(resolved).toHaveLength(1);
      const name = `Spherse-Setup-0.5.1-${arch}.exe`;
      const bytes = f.uploaded.get(`spherse/releases/0.5.1/${name}`)!;
      expect(resolved[0].url.href).toBe(url(name));
      expect(resolved[0].info).toEqual({ url: url(name), size: bytes.length, sha512: createHash("sha512").update(bytes).digest("base64") });
    }
  });

  it.each([0, 1, 2, 3, 4, 5])("installer upload failure %i generates and publishes no manifests", async (failureIndex) => {
    const f = await fixture();
    const upload = f.store.upload.getMockImplementation()!;
    f.store.upload.mockImplementation(async (path, key) => {
      if (f.store.upload.mock.calls.length - 1 === failureIndex) throw new Error("upload failed");
      await upload(path, key);
    });
    await expect(publishRelease(f)).rejects.toThrow("upload failed");
    expect(existsSync(f.outputDirectory)).toBe(false);
    expect([...f.uploaded.keys()].every((key) => key.includes("/releases/"))).toBe(true);
    expect(f.store.upload).toHaveBeenCalledTimes(failureIndex + 1);
  });

  it("does not even read installer bytes for feeds before the last upload resolves", async () => {
    const f = await fixture();
    const upload = f.store.upload.getMockImplementation()!;
    f.store.upload.mockImplementation(async (path, key) => {
      await upload(path, key);
      if (f.uploaded.size === f.names.length) await rm(join(f.directory, f.names[2]));
    });
    await expect(publishRelease(f)).rejects.toThrow("ENOENT");
    expect(f.uploaded.size).toBe(f.names.length);
    expect(existsSync(f.outputDirectory)).toBe(false);
  });

  it.each([0, 1, 2])("stops on manifest upload failure %i and allows a same-version retry", async (index) => {
    const f = await fixture();
    const upload = f.store.upload.getMockImplementation()!;
    f.store.upload.mockImplementation(async (path, key) => {
      if (key === stableKeys[index]) throw new Error("metadata upload failed");
      await upload(path, key);
    });
    await expect(publishRelease(f)).rejects.toThrow("metadata upload failed");
    expect([...f.uploaded.keys()].filter((key) => stableKeys.includes(key))).toEqual(stableKeys.slice(0, index));
    f.store.read.mockImplementation(async (key) => f.uploaded.get(key)?.toString() ?? null);
    f.store.upload.mockImplementation(upload);
    await publishRelease(f);
    for (const key of stableKeys) expect(f.uploaded.has(key)).toBe(true);
  });

  it("allows an identical same-version retry, reading metadata once and generating only after uploads", async () => {
    const f = await fixture();
    await publishRelease(f);
    await rm(f.outputDirectory, { recursive: true });
    f.store.read.mockClear().mockImplementation(async (key) => f.uploaded.get(key)?.toString() ?? null);
    const upload = f.store.upload.getMockImplementation()!;
    f.store.upload.mockClear().mockImplementation(async (path, key) => {
      if (key.includes("/releases/")) expect(existsSync(f.outputDirectory)).toBe(false);
      await upload(path, key);
    });
    await publishRelease(f);
    expect(f.store.read.mock.calls.map(([key]) => key)).toEqual(stableKeys);
    expect(f.store.upload).toHaveBeenCalledTimes(f.names.length + stableKeys.length);
  });

  it.each([
    { arch: "x64", partial: false }, { arch: "arm64", partial: false },
    { arch: "x64", partial: true }, { arch: "arm64", partial: true },
  ])("rejects changed $arch bytes before any writes, including partial=$partial publication", async ({ arch, partial }) => {
    const f = await fixture();
    await publishRelease(f);
    await rm(f.outputDirectory, { recursive: true });
    const feedKey = `spherse/win/${arch}/latest.yml`;
    if (partial) {
      for (const key of stableKeys) if (key !== feedKey) f.uploaded.delete(key);
    }
    const before = new Map(f.uploaded);
    const path = join(f.directory, `Spherse-Setup-${f.version}-${arch}.exe`);
    const bytes = await readFile(path);
    bytes[0] ^= 0xff;
    await writeFile(path, bytes);
    f.store.read.mockClear().mockImplementation(async (key) => f.uploaded.get(key)?.toString() ?? null);
    f.store.upload.mockClear();
    await expect(publishRelease(f)).rejects.toThrow(`Refusing changed installer for existing feed: ${feedKey}`);
    expect(f.store.read.mock.calls.map(([key]) => key)).toEqual(stableKeys);
    expect(f.store.upload).not.toHaveBeenCalled();
    expect(f.uploaded).toEqual(before);
    expect(existsSync(f.outputDirectory)).toBe(false);
  });

  it.each(["size", "sha512", "files", "url"])("fails closed on same-version feed with invalid %s before writes", async (field) => {
    const f = await fixture();
    await publishRelease(f);
    await rm(f.outputDirectory, { recursive: true });
    const manifest = JSON.parse(f.uploaded.get(stableKeys[1])!.toString());
    if (field === "files") manifest.files = [];
    else if (field === "size") manifest.files[0].size += 1;
    else delete manifest.files[0][field];
    f.uploaded.set(stableKeys[1], Buffer.from(JSON.stringify(manifest)));
    f.store.read.mockImplementation(async (key) => f.uploaded.get(key)?.toString() ?? null);
    f.store.upload.mockClear();
    await expect(publishRelease(f)).rejects.toThrow();
    expect(f.store.upload).not.toHaveBeenCalled();
    expect(existsSync(f.outputDirectory)).toBe(false);
  });

  it.each([0, 1, 2, 3, 4, 5])("normal releases require artifact %i before any OSS writes", async (index) => {
    const f = await fixture();
    await rm(join(f.directory, f.names[index]));
    await expect(publishRelease(f)).rejects.toThrow("Expected one installer");
    expect(f.store.upload).not.toHaveBeenCalled();
  });

  it.each([
    { GITHUB_EVENT_NAME: "workflow_dispatch" },
    { GITHUB_EVENT_NAME: "workflow_dispatch", HISTORICAL_ASSETS: "false" },
    { GITHUB_EVENT_NAME: "workflow_dispatch", HISTORICAL_ASSETS: "1" },
    { GITHUB_EVENT_NAME: "workflow_dispatch", HISTORICAL_ASSETS: "TRUE" },
    { GITHUB_EVENT_NAME: "push", HISTORICAL_ASSETS: "true" },
  ])("keeps incomplete current releases strict for %j", async (env) => {
    expect(usesHistoricalAssets(env)).toBe(false);
    for (const index of [3, 4, 5]) {
      const f = await fixture();
      await rm(join(f.directory, f.names[index]));
      await expect(publishRelease({ ...f, historical: usesHistoricalAssets(env) })).rejects.toThrow("Expected one installer");
      expect(f.store.read).not.toHaveBeenCalled();
      expect(f.store.upload).not.toHaveBeenCalled();
      expect(existsSync(f.outputDirectory)).toBe(false);
    }
  });

  it.each([
    { version: "0.1.14", windows: ["Spherse.Setup.0.1.14.exe"] },
    { version: "0.3.0", windows: ["Spherse-Setup-0.3.0-x64.exe", "Spherse-Setup-0.3.0-arm64.exe"] },
  ])("supports actual historical $version filenames and optional feeds only with explicit dispatch opt-in", async ({ version, windows }) => {
    const f = await fixture(version, [`Spherse-${version}-arm64.dmg`, `Spherse-${version}-intel.dmg`, ...windows]);
    await expect(publishRelease({ ...f, historical: usesHistoricalAssets({ GITHUB_EVENT_NAME: "workflow_dispatch" }) })).rejects.toThrow("Expected one installer");
    expect(f.store.upload).not.toHaveBeenCalled();
    const historical = usesHistoricalAssets({ GITHUB_EVENT_NAME: "workflow_dispatch", HISTORICAL_ASSETS: "true" });
    expect(historical).toBe(true);
    await publishRelease({ ...f, historical });
    const json = JSON.parse(f.uploaded.get("spherse/latest.json")!.toString());
    expect(json.linux).toBeUndefined();
    expect(json.win.x64).toBe(`${publicBaseUrl}/spherse/releases/${version}/${windows[0]}`);
    expect(f.uploaded.has(stableKeys[1])).toBe(windows.length === 2);
    expect(Object.keys(json.win)).toHaveLength(windows.length);
  });

  it("does not replace an existing arm64 feed when a historical release has no arm64 installer", async () => {
    const f = await fixture("0.1.14", ["Spherse-0.1.14-arm64.dmg", "Spherse-0.1.14-intel.dmg", "Spherse.Setup.0.1.14.exe"]);
    const existing = Buffer.from('{"version":"0.1.13"}');
    f.uploaded.set(stableKeys[1], existing);
    f.store.read.mockImplementation(async (key) => f.uploaded.get(key)?.toString() ?? null);
    await publishRelease({ ...f, historical: true });
    expect(f.uploaded.get(stableKeys[1])).toBe(existing);
    expect(existsSync(join(f.outputDirectory, stableKeys[1]))).toBe(false);
  });

  it("rejects ambiguous, empty or wrong-version required artifacts", async () => {
    const f = await fixture();
    const legacy = join(f.directory, "Spherse.Setup.0.5.1.exe");
    await writeFile(legacy, "legacy");
    await expect(discoverAssets(f.directory, f.version, true)).rejects.toThrow("Expected one installer");
    await rm(legacy);
    await writeFile(join(f.directory, f.names[2]), "");
    await expect(discoverAssets(f.directory, f.version)).rejects.toThrow("Invalid installer");
    await rm(join(f.directory, f.names[2]));
    await writeFile(join(f.directory, "Spherse-Setup-0.4.1-x64.exe"), "wrong version");
    await expect(discoverAssets(f.directory, f.version)).rejects.toThrow("Expected one installer");
  });

  it.each(["http://example.com", "https://user:pass@example.com", "https://example.com/?x=1", "https://example.com/#fragment"])("rejects unsafe installer base %s", async (base) => {
    const f = await fixture();
    const assets = await discoverAssets(f.directory, f.version);
    await expect(buildManifests({ ...f, assets, publicBaseUrl: base })).rejects.toThrow("HTTPS base URL");
  });
});

describe("stable version guard", () => {
  it.each(stableKeys)("aborts before installer writes when reading %s fails", async (failedKey) => {
    const f = await fixture();
    f.store.read.mockImplementation(async (key) => {
      if (key === failedKey) throw new Error("Cannot read stable metadata");
      return null;
    });
    await expect(publishRelease(f)).rejects.toThrow("Cannot read stable metadata");
    expect(f.store.upload).not.toHaveBeenCalled();
  });

  it.each(stableKeys)("blocks downgrade when only %s advanced in a partial publication", async (advancedKey) => {
    const f = await fixture();
    f.store.read.mockImplementation(async (key) => JSON.stringify({ version: key === advancedKey ? "0.10.0" : "0.4.1" }));
    await expect(publishRelease(f)).rejects.toThrow("Refusing stable downgrade");
    expect(f.store.upload).not.toHaveBeenCalled();
    expect(existsSync(f.outputDirectory)).toBe(false);
  });

  it.each([null, "0.5.1", "0.4.99", "0.5.0"])("allows absent, equal or older stable version %s, inspecting every key", async (version) => {
    const read = vi.fn(async () => version === null ? null : JSON.stringify({ version }));
    await assertStableVersion("0.5.1", { read });
    expect(read.mock.calls.map(([key]) => key)).toEqual(stableKeys);
  });

  it.each(["", "{}", "null", "<html>error</html>", '{"version":"0.6.0-beta.1"}', '{"version":5}', '{"version":"01.0.0"}'])(
    "fails closed on invalid metadata %s even in the last key", async (raw) => {
      const f = await fixture();
      f.store.read.mockImplementation(async (key) => key === stableKeys[2] ? raw : null);
      await expect(publishRelease(f)).rejects.toThrow();
      expect(f.store.upload).not.toHaveBeenCalled();
    });

  it.each(["0.6.0-beta.1", "0.5", "v0.5.1", "../0.5.1", "01.0.0"])("rejects non-stable target %s", async (version) => {
    const read = vi.fn();
    await expect(assertStableVersion(version, { read })).rejects.toThrow("Invalid stable version");
    expect(read).not.toHaveBeenCalled();
  });
});

describe("OSS adapter", () => {
  const env = { OSS_BUCKET: "bucket", OSS_ENDPOINT: "https://oss.example.com", OSS_ACCESS_KEY_ID: "id", OSS_ACCESS_KEY_SECRET: "secret" };

  it("reads origin metadata with authenticated OSS GET and never skips overwriting uploads", async () => {
    const run = vi.fn(() => '{"version":"0.5.1"}\n\n0.123456(s) elapsed\n');
    const store = createOssStore(env, run);
    expect(JSON.parse(await store.read(stableKeys[0]))).toEqual({ version: "0.5.1" });
    expect(run.mock.calls[0][1]).toEqual([
      "cat", `oss://bucket/${stableKeys[0]}`, "-e", env.OSS_ENDPOINT, "-i", "id", "-k", "secret",
    ]);
    await store.upload("installer.exe", "spherse/releases/0.5.1/installer.exe");
    expect(run.mock.calls[1][1]).toEqual([
      "cp", "installer.exe", "oss://bucket/spherse/releases/0.5.1/installer.exe", "--force",
      "-e", env.OSS_ENDPOINT, "-i", "id", "-k", "secret",
    ]);
  });

  it.each(["stdout", "stderr"])("only treats OSS 404 NoSuchKey on %s as genuinely missing", async (stream) => {
    const store = createOssStore(env, () => { throw { status: 1, [stream]: "Error: oss: service returned error: StatusCode=404, ErrorCode=NoSuchKey, ErrorMessage=missing" }; });
    expect(await store.read(stableKeys[0])).toBeNull();
  });

  it.each([
    "StatusCode=403, ErrorCode=AccessDenied,",
    "StatusCode=404, ErrorCode=NoSuchBucket,",
    "StatusCode=500, ErrorCode=InternalError,",
    "404 Not Found", "NoSuchKey", "ETIMEDOUT", "ENOTFOUND",
  ])("fails closed and redacts credentials on %s", async (diagnostic) => {
    const store = createOssStore(env, () => { throw { status: 1, stdout: diagnostic, message: "secret" }; });
    await expect(store.read(stableKeys[0])).rejects.toThrow(`Cannot read stable metadata: ${stableKeys[0]}`);
    await expect(store.upload("path", stableKeys[0])).rejects.toThrow(`Cannot upload: ${stableKeys[0]}`);
  });
});
