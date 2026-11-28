import type { Capability } from "../kernel/capability.js";

export interface CapabilityContributions {
  snapshot(): ReadonlyArray<Capability>;
  push(capability: Capability): void;
  pull(capability: Capability): void;
  has(id: string): boolean;
}

export function createCapabilityContributions(): CapabilityContributions {
  let current: ReadonlyArray<Capability> = Object.freeze([]);
  return {
    snapshot: () => current,
    push: (capability) => {
      current = Object.freeze([...current, capability]);
    },
    pull: (capability) => {
      current = Object.freeze(current.filter((c) => c !== capability));
    },
    has: (id) => current.some((c) => c.id === id),
  };
}
