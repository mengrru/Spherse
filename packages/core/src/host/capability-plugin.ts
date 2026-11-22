import { ConflictError } from "../errors.js";
import type { Capability, CapabilityRegistry, KernelServices } from "../kernel/capability.js";
import type { HostContext, HostFiber } from "./context.js";

export interface CapabilityPlugin {
  plugin: (ctx: HostContext) => Promise<void>;
  ready: Promise<void>;
  fiber?: HostFiber;
}

export function defineCapabilityPlugin(
  capability: Capability,
  kernelServices: KernelServices,
  registry: CapabilityRegistry,
): CapabilityPlugin {
  let markReady!: () => void;
  let markFailed!: (err: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    markFailed = reject;
  });
  const plugin = async (_ctx: HostContext) => {
    try {
      registry.register(capability);
    } catch (err) {
      if (err instanceof ConflictError) {
        kernelServices.logger.warn({ capability: capability.id }, "duplicate capability id, host view keeps the first");
      } else {
        throw err;
      }
    }
    try {
      if (capability.init) {
        await capability.init(kernelServices);
      }
      markReady();
    } catch (err) {
      markFailed(err);
    }
  };
  return { plugin, ready };
}
