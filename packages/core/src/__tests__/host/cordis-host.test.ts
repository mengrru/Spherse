import { describe, expect, it } from "vitest";
import { HostServiceKey, createHostContext } from "../../host/context.js";
import { registerCoreServices } from "../../host/services.js";
import { defineCapabilityPlugin } from "../../host/capability-plugin.js";
import { createCapabilityContributions } from "../../host/contributions.js";
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
    const contributions = createCapabilityContributions();
    registerCoreServices(ctx, {
      fs: { capabilities: { atomicRename: true, watch: false } } as never,
      logger: createSilentLogger(),
      fileWriteMutex: new FileWriteMutex(),
      projectStore: { mark: 1 } as never,
      stores: {} as never,
      sessionStoreFactory: () => ({}) as never,
      memoryStoreFactory: () => ({}) as never,
      capabilities: contributions,
    });
    expect(ctx.get(HostServiceKey.fs)).toBeDefined();
    expect(ctx.get(HostServiceKey.logger)).toBeDefined();
    expect(ctx.get(HostServiceKey.fileWriteMutex)).toBeDefined();
    expect(ctx.get(HostServiceKey.projectStore)).toBeDefined();
    expect(ctx.get(HostServiceKey.stores)).toBeDefined();
    expect(ctx.get(HostServiceKey.sessionStoreFactory)).toBeTypeOf("function");
    expect(ctx.get(HostServiceKey.memoryStoreFactory)).toBeTypeOf("function");
    expect(ctx.get(HostServiceKey.capabilities)).toBe(contributions);
    expect(ctx.get(HostServiceKey.data)).toBeUndefined();
  });
});

describe("CapabilityContributions", () => {
  it("push/pull/has with copy-on-write frozen snapshots", () => {
    const contributions = createCapabilityContributions();
    const a: Capability = { id: "a" };
    const b: Capability = { id: "b" };
    const empty = contributions.snapshot();
    contributions.push(a);
    const one = contributions.snapshot();
    contributions.push(b);
    const two = contributions.snapshot();
    expect(empty).toEqual([]);
    expect(one.map((c) => c.id)).toEqual(["a"]);
    expect(two.map((c) => c.id)).toEqual(["a", "b"]);
    expect(Object.isFrozen(two)).toBe(true);
    expect(empty).toEqual([]);
    expect(one.map((c) => c.id)).toEqual(["a"]);
    expect(contributions.has("a")).toBe(true);
    contributions.pull(a);
    expect(contributions.snapshot().map((c) => c.id)).toEqual(["b"]);
    expect(contributions.has("a")).toBe(false);
  });
});

describe("defineCapabilityPlugin", () => {
  it("inits capabilities serially in registration order and publishes after init", async () => {
    const ctx = createHostContext();
    const contributions = createCapabilityContributions();
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
      defineCapabilityPlugin(cap, services, contributions),
    );
    const fiber0 = ctx.plugin(wrappers[0]!.plugin);
    expect(contributions.snapshot().length).toBe(0);
    await wrappers[0]!.ready;
    expect(contributions.snapshot().map((c) => c.id)).toEqual(["a"]);
    for (const wrapper of wrappers.slice(1)) {
      ctx.plugin(wrapper.plugin);
      await wrapper.ready;
    }
    expect(order).toEqual(["a", "b", "c"]);
    expect(contributions.snapshot().map((c) => c.id)).toEqual(["a", "b", "c"]);
    await fiber0.dispose();
    expect(contributions.snapshot().map((c) => c.id)).toEqual(["b", "c"]);
  });

  it("propagates init failure, contribution never published, later capabilities not inited", async () => {
    const ctx = createHostContext();
    const contributions = createCapabilityContributions();
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
    const wrappers = [boom, after].map((cap) => defineCapabilityPlugin(cap, services, contributions));
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
    expect(contributions.snapshot().map((c) => c.id)).toEqual([]);
  });

  it("keeps both entries for duplicate ids (assembly semantics)", async () => {
    const ctx = createHostContext();
    const contributions = createCapabilityContributions();
    const services = fakeKernelServices();
    const order: string[] = [];
    const first: Capability = { id: "dup" };
    const second: Capability = { id: "dup", init: async () => { order.push("second-inited"); } };
    const w1 = defineCapabilityPlugin(first, services, contributions);
    const w2 = defineCapabilityPlugin({ ...second, init: async () => { order.push("second-inited"); } }, services, contributions);
    ctx.plugin(w1.plugin);
    await w1.ready;
    ctx.plugin(w2.plugin);
    await w2.ready;
    expect(contributions.snapshot().length).toBe(2);
    expect(order).toEqual(["second-inited"]);
  });
});
