import type { Capability, KernelServices } from "../kernel/capability.js";
import type { CapabilityContributions } from "./contributions.js";
import type { HostContext } from "./context.js";

export interface CapabilityPlugin {
  plugin: (ctx: HostContext) => Promise<() => void>;
  ready: Promise<void>;
}

export function defineCapabilityPlugin(
  capability: Capability,
  kernelServices: KernelServices,
  contributions: CapabilityContributions,
): CapabilityPlugin {
  let markReady!: () => void;
  let markFailed!: (err: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    markFailed = reject;
  });
  const plugin = async (_ctx: HostContext) => {
    try {
      if (capability.init) {
        await capability.init(kernelServices);
      }
      contributions.push(capability);
      markReady();
    } catch (err) {
      markFailed(err);
    }
    return () => {
      contributions.pull(capability);
    };
  };
  return { plugin, ready };
}
