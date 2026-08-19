import type { AgentEvent, AgentTool } from "@earendil-works/pi-agent-core";
import { ConflictError } from "../errors.js";
import type { ContextBlock } from "./context-block.js";
import type { EventMiddleware } from "./event-pipeline.js";
import type { TurnHooksFactory } from "./turn-hooks.js";
import type { AttachmentProcessor } from "../attachments/index.js";
import type { KernelServices, PathRule, SessionView, ToolHost } from "./ports.js";

export type { KernelServices } from "./ports.js";

export type AgentConfigChangeKind = "mcp" | "tools" | "profile";

export interface TurnMiddlewareSource {
  eventMiddlewares?: ReadonlyArray<EventMiddleware<AgentEvent>>;
}

export interface Capability extends TurnMiddlewareSource {
  readonly id: string;
  init?(ctx: KernelServices): Promise<void>;
  tools?(host: ToolHost): AgentTool[];
  contextBlocks?(view: SessionView): Promise<ContextBlock[]>;
  turnHooks?: TurnHooksFactory;
  attachmentProcessors?: ReadonlyArray<AttachmentProcessor>;
  readonly pathRules?: ReadonlyArray<PathRule>;
  onAgentDeleted?(agentId: string): Promise<void> | void;
  onAgentConfigChanged?(agentId: string, kind: AgentConfigChangeKind): Promise<void>;
  shutdown?(): Promise<void>;
}

export class CapabilityRegistry {
  private readonly map = new Map<string, Capability>();

  register(capability: Capability): void {
    if (this.map.has(capability.id)) {
      throw new ConflictError(`Capability "${capability.id}" is already registered`);
    }
    this.map.set(capability.id, capability);
  }

  byId(id: string): Capability | undefined {
    return this.map.get(id);
  }

  all(): Capability[] {
    return [...this.map.values()];
  }

  get size(): number {
    return this.map.size;
  }
}
