import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../worker/polyfills.js";
import type { RpcClientFrame, RpcServerFrame } from "@spherse/contracts";
import { RpcClient, type RpcTransport } from "@spherse/rpc";
import { BrowserRpcApp } from "../worker/rpc-app.js";

class MessagePortTransport implements RpcTransport {
  private readonly frameHandlers = new Set<(frame: RpcServerFrame) => void>();
  private readonly closedHandlers = new Set<() => void>();
  connected = false;

  constructor(private readonly port: MessagePort) {}

  async connect(): Promise<void> {
    if (!this.connected) {
      this.port.onmessage = (ev: MessageEvent) => {
        const raw = ev.data;
        if (typeof raw !== "string") return;
        let frame: RpcServerFrame;
        try {
          frame = JSON.parse(raw) as RpcServerFrame;
        } catch {
          return;
        }
        for (const handler of this.frameHandlers) handler(frame);
      };
      this.connected = true;
    }
  }

  send(frame: RpcClientFrame): void {
    this.port.postMessage(frame);
  }

  onFrame(handler: (frame: RpcServerFrame) => void): () => void {
    this.frameHandlers.add(handler);
    return () => this.frameHandlers.delete(handler);
  }

  onClosed(handler: () => void): () => void {
    this.closedHandlers.add(handler);
    return () => this.closedHandlers.delete(handler);
  }

  close(): void {
    this.port.close();
  }
}

async function wipeOpfs(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  for (const name of ["spherse-registry.json", "spherse-model-settings.json", "projects"]) {
    try {
      await root.removeEntry(name, { recursive: true });
    } catch (err) {
      void err;
    }
  }
}

describe("browser worker rpc", () => {
  let app: BrowserRpcApp;
  let client: RpcClient;
  let clientPort: MessagePort;
  let projectId: string;

  beforeAll(async () => {
    await wipeOpfs();
    app = await BrowserRpcApp.create({ appVersion: "test" });
    const channel = new MessageChannel();
    app.attachPort(channel.port1);
    clientPort = channel.port2;
    client = new RpcClient(new MessagePortTransport(clientPort));
    await client.connect();
  });

  afterAll(async () => {
    client.dispose();
    await app.registry.removeAll();
    await wipeOpfs();
  });

  it("answers connection.info", async () => {
    const info = await client.call<{ serverVersion: string; authRequired: boolean; appVersion: string | null }>(
      "connection.info",
    );
    expect(info.serverVersion).toBeTypeOf("string");
    expect(info.authRequired).toBe(false);
    expect(info.appVersion).toBe("test");
  });

  it("creates a project and lists it", async () => {
    projectId = await app.registry.create("demo");
    expect(projectId).toBeTypeOf("string");
    const projects = await client.call<Array<{ id: string; name: string }>>("connection.projects");
    const demo = projects.find((entry) => entry.id === projectId);
    expect(demo?.name).toBe("demo");
  });

  it("creates a session through the real idb session store", async () => {
    const agents = await client.call<Array<{ id: string; name: string }>>("agents.list", {
      projectId,
    });
    expect(agents.length).toBeGreaterThan(0);
    const agentId = agents[0].id;
    const created = await client.call<{ sessionId: string }>("sessions.create", {
      projectId,
      agentId,
      title: "hello browser",
    });
    expect(created.sessionId).toBeTypeOf("string");
    const renamed = await client.call<{ id: string; title?: string }>("sessions.rename", {
      projectId,
      agentId,
      sessionId: created.sessionId,
      title: "renamed session",
    });
    expect(renamed.title).toBe("renamed session");
    const events = await client.call<{ events: unknown[] }>("debug.sessionEvents", {
      projectId,
      agentId,
      sessionId: created.sessionId,
    });
    expect(Array.isArray(events.events)).toBe(true);
  });

  it("saves and reads content through the real opfs port", async () => {
    await client.call("content.save", {
      projectId,
      path: "notes/hello.md",
      content: "# hello from browser",
    });
    const read = await client.call<{ content: string; binary: boolean; path: string }>("content.read", {
      projectId,
      path: "notes/hello.md",
    });
    expect(read.content).toBe("# hello from browser");
    expect(read.binary).toBe(false);
    const tree = await client.call<string[]>("content.fileTree", { projectId });
    expect(tree).toContain("notes/hello.md");
  });

  it("uploads an attachment and reads it back as binary", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const blob = new Blob([pngBytes], { type: "image/png" });
    const uploaded = await client.call<{ type: string; path: string; width?: number; height?: number; bytes: number }>(
      "attachments.upload",
      {
        projectId,
        file: blob,
        width: 4,
        height: 4,
      },
    );
    expect(uploaded.type).toBe("image");
    expect(uploaded.path).toMatch(/^\.spherse\/attachments\/\d+-[0-9a-f]{4}\.png$/);
    expect(uploaded.bytes).toBe(pngBytes.byteLength);
    expect(uploaded.width).toBe(4);
    const read = await client.call<{ content: string; binary: boolean }>("content.read", {
      projectId,
      path: uploaded.path,
    });
    expect(read.binary).toBe(true);
    expect(read.content).toBe("");
    await client.call("attachments.delete", { projectId, path: uploaded.path });
    const stat = await client
      .call("content.stat", { projectId, path: uploaded.path })
      .catch((err) => err);
    expect(stat).toBeInstanceOf(Error);
  });

  it("rejects uploads with unsupported media types", async () => {
    const blob = new Blob(["plain"], { type: "text/plain" });
    await expect(
      client.call("attachments.upload", { projectId, file: blob }),
    ).rejects.toThrow("Unsupported media type");
  });

  it("reads and updates model settings", async () => {
    const initial = await client.call<{
      models: { text: { defaultModel: string; providers: Record<string, unknown> } };
      customProviders: unknown[];
    }>("settings.getModels");
    expect(initial.models.text.defaultModel).toBe("");
    const updated = await client.call<{
      models: { text: { defaultModel: string; providers: Record<string, { configured: boolean }> } };
    }>("settings.updateModels", {
      models: {
        text: { defaultModel: "openai/gpt-4o", providers: { openai: { apiKey: "sk-test" } } },
        image: { defaultModel: "", providers: {} },
      },
    });
    expect(updated.models.text.defaultModel).toBe("openai/gpt-4o");
    expect(updated.models.text.providers.openai).toEqual({ configured: true });
    const reread = await client.call<{ models: { text: { defaultModel: string } } }>(
      "settings.getModels",
    );
    expect(reread.models.text.defaultModel).toBe("openai/gpt-4o");
    const { ModelCatalog } = await import("@spherse/core");
    const probe = new ModelCatalog();
    probe.setProviderApiKeys({ deepseek: "sk-browser-test" });
    expect(await probe.getChatModels().checkAuth("deepseek")).toMatchObject({ type: "api_key" });
  });

  it("reads project theme and file entries via fs port", async () => {
    const theme = await client.call<{ ok: boolean; content: string }>("settings.getTheme", {
      projectId,
    });
    expect(theme.ok).toBe(true);
    const entries = await client.call<Array<{ name: string; type: string }>>("content.list", {
      projectId,
    });
    expect(entries).toContainEqual({ name: ".spherse", type: "directory" });
    expect(entries).toContainEqual({ name: "notes", type: "directory" });
  });

  it("persists projects across app restarts", async () => {
    const agents = await client.call<Array<{ id: string }>>("agents.list", { projectId });
    const created = await client.call<{ sessionId: string }>("sessions.create", {
      projectId,
      agentId: agents[0].id,
      title: "persisted",
    });
    await client.call("sessions.rename", {
      projectId,
      agentId: agents[0].id,
      sessionId: created.sessionId,
      title: "still here",
    });

    await client.call("settings.updateModels", {
      models: {
        text: { defaultModel: "deepseek/deepseek-chat", providers: { deepseek: { apiKey: "sk-persist" } } },
        image: { defaultModel: "", providers: {} },
      },
    });

    const app2 = await BrowserRpcApp.create({ appVersion: "test" });
    const channel2 = new MessageChannel();
    app2.attachPort(channel2.port1);
    const client2 = new RpcClient(new MessagePortTransport(channel2.port2));
    await client2.connect();
    try {
      const replayed = await client2.call<{
        models: { text: { defaultModel: string; providers: Record<string, { configured: boolean }> } };
      }>("settings.getModels");
      expect(replayed.models.text.defaultModel).toBe("deepseek/deepseek-chat");
      expect(replayed.models.text.providers.deepseek).toEqual({ configured: true });
      const projects = await client2.call<Array<{ id: string; name: string }>>("connection.projects");
      const demo = projects.find((entry) => entry.name === "demo");
      expect(demo).toBeDefined();
      const warmedAgents = await client2.call<Array<{ id: string }>>("agents.list", {
        projectId: demo!.id,
      });
      expect(warmedAgents.length).toBeGreaterThan(0);
      const reopenedId = await app2.registry.create("demo");
      expect(reopenedId).toBe(demo!.id);
      const sessions = await client2.call<{ sessions: Array<{ id: string; title?: string }> }>(
        "sessions.listProject",
        {
          projectId: reopenedId,
          perPage: 50,
        },
      );
      const persisted = sessions.sessions.find((entry) => entry.id === created.sessionId);
      expect(persisted?.title).toBe("still here");
    } finally {
      client2.dispose();
    }
  });
});

describe("browser rpc method map guard", () => {
  it("browser-only methods are covered by the contract map", async () => {
    const { rpcMethodSchemas } = await import("@spherse/contracts");
    const { buildBrowserMethodRegistry } = await import("../worker/methods/index.js");
    const { buildBaseMethodRegistry } = await import("@spherse/rpc/methods");
    const base = new Set(buildBaseMethodRegistry().keys());
    for (const key of [...buildBrowserMethodRegistry().keys()]) {
      if (base.has(key)) continue;
      expect(
        (rpcMethodSchemas as Record<string, unknown>)[key],
        `missing map entry for browser method ${key}`,
      ).toBeDefined();
    }
  });
});
