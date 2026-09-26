import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PushStore } from "../push/push-store.js";

describe("PushStore", () => {
  let tmpDir: string;
  let filePath: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-push-store-"));
    filePath = path.join(tmpDir, "push-storage.json");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates vapid keys lazily and persists them", async () => {
    const store = new PushStore(filePath);
    const first = store.getVapid();
    expect(first.publicKey).toBeTruthy();
    expect(first.privateKey).toBeTruthy();
    await store.flush();

    const reloaded = new PushStore(filePath);
    expect(reloaded.getVapid()).toEqual(first);
  });

  it("upserts by endpoint and updates locale/keys", async () => {
    const store = new PushStore(filePath);
    store.upsert({ endpoint: "https://push.example/a", keys: { p256dh: "k1", auth: "a1" }, locale: "zh-CN" });
    store.upsert({ endpoint: "https://push.example/a", keys: { p256dh: "k2", auth: "a2" }, locale: "en" });
    store.upsert({ endpoint: "https://push.example/b", keys: { p256dh: "k3", auth: "a3" }, locale: "zh-TW" });
    await store.flush();

    const reloaded = new PushStore(filePath);
    const subs = reloaded.list();
    expect(subs).toHaveLength(2);
    expect(subs.find((s) => s.endpoint === "https://push.example/a")).toMatchObject({
      keys: { p256dh: "k2", auth: "a2" },
      locale: "en",
    });
  });

  it("removes subscriptions and survives reload", async () => {
    const store = new PushStore(filePath);
    store.remove("https://push.example/b");
    store.remove("https://push.example/missing");
    await store.flush();

    const reloaded = new PushStore(filePath);
    expect(reloaded.list().map((s) => s.endpoint)).toEqual(["https://push.example/a"]);
  });

  it("treats a corrupt file as empty state", async () => {
    fs.writeFileSync(filePath, "not json{", "utf-8");
    const store = new PushStore(filePath);
    expect(store.list()).toEqual([]);
    expect(store.getVapid().publicKey).toBeTruthy();
    await store.flush();
  });
});
