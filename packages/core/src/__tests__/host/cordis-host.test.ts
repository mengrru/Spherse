import { describe, expect, it } from "vitest";
import { HostServiceKey, createHostContext } from "../../host/context.js";
import { registerCoreServices } from "../../host/services.js";
import { defineCapabilityPlugin } from "../../host/capability-plugin.js";
import { CapabilityRegistry } from "../../kernel/capability.js";
import type { Capability, KernelServices } from "../../kernel/capability.js";
import { createSilentLogger } from "../../logger.js";
import { FileWriteMutex } from "../../utils/file-write-mutex.js";

function fakeKernelServices(): KernelServices {
  return {
    projectRoot: "/proj",
    metaDir: "/proj/.spherse",
    logger: createSilentLogger(),
    fileWriteMutex: new FileWriteMutex(),
    stores: { agent: () => undefined },
    session: {
      createSession: async () => "s",
      restoreSession: async () => undefined,
      sendMessage: async () => undefined,
      abortSession: () => undefined,
      sessionExists: () => false,
    },
  } as unknown as KernelServices;
}

describe("cordis host api probe", () => {
  it("constructs a 4.x root context and resolves services across extend", () => {
    const ctx = createHostContext();
    ctx.provide("probe.svc", { v: 7 });
    expect(ctx.get("probe.svc")).toMatchObject({ v: 7 });
    expect(ctx.extend().get("probe.svc")).toMatchObject({ v: 7 });
  });

  it("sees provided services inside plugin fibers", async () => {
    const ctx = createHostContext();
    ctx.provide("probe.dep", { tag: "x" });
    let seen: unknown;
    const fiber = ctx.plugin((c) => {
      seen = c.get("probe.dep");
      return undefined;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(seen).toMatchObject({ tag: "x" });
    await fiber.dispose();
  });

  it("tolerates repeated fiber dispose", async () => {
    const ctx = createHostContext();
    const fiber = ctx.plugin(() => undefined);
    await new Promise((resolve) => setImmediate(resolve));
    await fiber.dispose();
    const second = fiber.dispose();
    if (second instanceof Promise) await second;
  });
});

describe("registerCoreServices", () => {
  it("registers the core service set without undefined factories", () => {
    const ctx = createHostContext();
    const registry = new CapabilityRegistry();
    registerCoreServices(ctx, {
      fs: { capabilities: { atomicRename: true, watch: false } } as never,
      logger: createSilentLogger(),
      fileWriteMutex: new FileWriteMutex(),
      projectStore: { mark: 1 } as never,
      stores: {} as never,
      sessionStoreFactory: () => ({}) as never,
      memoryStoreFactory: () => ({}) as never,
      capabilities: registry,
    });
    expect(ctx.get(HostServiceKey.fs)).toBeDefined();
    expect(ctx.get(HostServiceKey.logger)).toBeDefined();
    expect(ctx.get(HostServiceKey.fileWriteMutex)).toBeDefined();
    expect(ctx.get(HostServiceKey.projectStore)).toBeDefined();
    expect(ctx.get(HostServiceKey.stores)).toBeDefined();
    expect(ctx.get(HostServiceKey.sessionStoreFactory)).toBeTypeOf("function");
    expect(ctx.get(HostServiceKey.memoryStoreFactory)).toBeTypeOf("function");
    expect(ctx.get(HostServiceKey.capabilities)).toBe(registry);
    expect(ctx.get(HostServiceKey.data)).toBeUndefined();
  });
});

describe("defineCapabilityPlugin", () => {
  it("inits capabilities serially in registration order", async () => {
    const ctx = createHostContext();
    const registry = new CapabilityRegistry();
    const order: string[] = [];
    const mk = (id: string, delay: number): Capability => ({
      id,
      init: async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        order.push(id);
      },
    });
    const services = fakeKernelServices();
    const wrappers = [mk("a", 30), mk("b", 5), mk("c", 0)].map((cap) =>
      defineCapabilityPlugin(cap, services, registry),
    );
    for (const wrapper of wrappers) {
      ctx.plugin(wrapper.plugin);
      await wrapper.ready;
    }
    expect(order).toEqual(["a", "b", "c"]);
    expect(registry.all().map((cap) => cap.id)).toEqual(["a", "b", "c"]);
  });

  it("propagates init failure and later capabilities are not inited", async () => {
    const ctx = createHostContext();
    const registry = new CapabilityRegistry();
    const order: string[] = [];
    const boom: Capability = {
      id: "boom",
      init: async () => {
        order.push("boom");
        throw new Error("init failed");
      },
    };
    const after: Capability = { id: "after", init: async () => { order.push("after"); } };
    const services = fakeKernelServices();
    const wrappers = [boom, after].map((cap) => defineCapabilityPlugin(cap, services, registry));
    let failure: unknown;
    try {
      for (const wrapper of wrappers) {
        ctx.plugin(wrapper.plugin);
        await wrapper.ready;
      }
    } catch (err) {
      failure = err;
    }
    expect(String(failure)).toContain("init failed");
    expect(order).toEqual(["boom"]);
  });

  it("warns and keeps the first view on duplicate ids", async () => {
    const ctx = createHostContext();
    const registry = new CapabilityRegistry();
    const services = fakeKernelServices();
    const first: Capability = { id: "dup" };
    const second: Capability = { id: "dup", init: async () => { order.push("second-inited"); } };
    const order: string[] = [];
    const w1 = defineCapabilityPlugin(first, services, registry);
    const w2 = defineCapabilityPlugin({ ...second, init: async () => { order.push("second-inited"); } }, services, registry);
    ctx.plugin(w1.plugin);
    await w1.ready;
    ctx.plugin(w2.plugin);
    await w2.ready;
    expect(registry.all().length).toBe(1);
    expect(order).toEqual(["second-inited"]);
  });
});
