import { Type } from "@sinclair/typebox";
import matter from "gray-matter";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ProjectStore } from "../store/project.js";
import type { AgentProfile } from "../types.js";
import { ValidationError, NotFoundError } from "../errors.js";

const ManageAgentParams = Type.Object({
  action: Type.Union(
    [
      Type.Literal("list"),
      Type.Literal("get"),
      Type.Literal("create"),
      Type.Literal("update"),
    ],
    {
      description:
        "`list` returns every agent in the project (metadata only). `get` returns one agent including its full system prompt. `create` adds a new agent. `update` patches an existing agent — only the fields you pass are changed.",
    },
  ),
  agent_id: Type.Optional(
    Type.String({
      description: "Target agent id. Required for `get` and `update`; ignored for `list` and `create`.",
    }),
  ),
  name: Type.Optional(
    Type.String({
      description:
        "Display name. Required for `create`. Renaming on `update` keeps the existing id and on-disk directory (slug) unchanged.",
    }),
  ),
  alias: Type.Optional(
    Type.String({
      description: "Optional short alias the user can use to address the agent. Pass an empty string to clear it.",
    }),
  ),
  system_prompt: Type.Optional(
    Type.String({
      description:
        "The agent's system prompt (markdown body of profile.md). Required for `create`. Replaces the whole prompt on `update`.",
    }),
  ),
  model: Type.Optional(
    Type.String({
      description:
        "Model id override for this agent, e.g. `openai/gpt-4o`. Pass an empty string to clear it and fall back to the app default model.",
    }),
  ),
  tools: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Full replacement list of enabled tool names. Only known built-in tool names are accepted. Omit to leave unchanged.",
    }),
  ),
  context: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Full replacement list of project-relative file paths preloaded into the agent's context. Only plain-text files are allowed (text/code/config extensions or well-known text filenames like Makefile/Dockerfile), and the total size of all files must stay within 512 kB. Omit to leave unchanged.",
    }),
  ),
  time_perception: Type.Optional(
    Type.Object(
      {
        enabled: Type.Boolean({
          description:
            "Turn the agent's time perception on or off. Enabling with no prior config materializes a 1:1 config (anchor = start = now, rate = 1); enabling over an existing config keeps its anchor/start/rate/timeZone.",
        }),
      },
      {
        description:
          "Toggle the agent's time perception. Only the switch is managed here — anchor, start, flow rate and time zone are configured by the user in the app UI.",
      },
    ),
  ),
});

export interface ManageAgentDetails {
  cardType: "manage_agent";
  action: string;
  agentId?: string;
  slug?: string;
  error?: boolean;
}

type ManageAgentResult = {
  content: { type: "text"; text: string }[];
  details: ManageAgentDetails;
};

function ok(action: string, text: string, extra?: Partial<ManageAgentDetails>): ManageAgentResult {
  return { content: [{ type: "text", text }], details: { cardType: "manage_agent", action, ...extra } };
}

function fail(action: string, text: string): ManageAgentResult {
  return { content: [{ type: "text", text: `Error: ${text}` }], details: { cardType: "manage_agent", action, error: true } };
}

export function isManageAgentWriteAction(params: unknown): boolean {
  const action = (params as { action?: unknown } | null)?.action;
  return action === "create" || action === "update";
}

function summarize(profile: AgentProfile): Record<string, unknown> {
  return {
    id: profile.id,
    name: profile.name,
    alias: profile.alias,
    slug: profile.slug,
    model: profile.model,
    tools: profile.tools ?? [],
    context: profile.context ?? [],
    timePerception: profile.timePerception
      ? {
          enabled: profile.timePerception.enabled,
          anchor: new Date(profile.timePerception.epochMs).toISOString(),
          start: new Date(profile.timePerception.startMs).toISOString(),
          flowRate: profile.timePerception.flowRate,
          ...(profile.timePerception.timeZone
            ? { timeZone: profile.timePerception.timeZone }
            : {}),
        }
      : undefined,
  };
}

function applyOptionalString(
  frontmatter: Record<string, unknown>,
  key: string,
  value: string | undefined,
): void {
  if (value === undefined) return;
  const trimmed = value.trim();
  if (trimmed) frontmatter[key] = trimmed;
  else delete frontmatter[key];
}

function applyTimePerception(
  frontmatter: Record<string, unknown>,
  params: { enabled: boolean } | undefined,
  now: number,
): void {
  if (params === undefined) return;
  if (!params.enabled) {
    delete frontmatter.timePerception;
    return;
  }
  const existing = frontmatter.timePerception;
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  const epochMs = num(base.epochMs) ?? now;
  const startMs = num(base.startMs) ?? epochMs;
  const flowRate = num(base.flowRate) ?? 1;
  const timeZone = typeof base.timeZone === "string" ? base.timeZone : undefined;
  frontmatter.timePerception = {
    epochMs,
    startMs,
    flowRate,
    ...(timeZone ? { timeZone } : {}),
    enabled: true,
  };
}

export type KnownToolsRef = { names: readonly string[] };

function validateTools(tools: string[] | undefined, knownTools: KnownToolsRef): string[] | undefined {
  if (tools === undefined) return undefined;
  const unknown = tools.filter((name) => !knownTools.names.includes(name));
  if (unknown.length > 0) {
    throw new ValidationError(
      `unknown tool name(s): ${unknown.join(", ")}. Known tools: ${knownTools.names.join(", ")}`,
    );
  }
  return [...new Set(tools)];
}

export function createManageAgentTool(
  projectStore: ProjectStore,
  knownTools: KnownToolsRef,
  currentAgentId?: string,
): AgentTool<typeof ManageAgentParams, ManageAgentDetails> {
  return {
    name: "manage_agent",
    label: "Manage Agent",
    description:
      "Inspect, create and edit the agents (roles) of this project — name, alias, system prompt, model, enabled tools, preloaded context files and the time perception switch. " +
      "Agent ids and on-disk directory names are generated by the app: you cannot choose them, and `update` never changes them. " +
      "Creating and updating requires explicit user approval before it takes effect. " +
      "Use `list` first to discover agent ids. Deleting an agent is intentionally not supported — ask the user to delete it in the UI.",
    parameters: ManageAgentParams,
    async execute(_toolCallId, params) {
      const action = params.action;
      try {
        switch (action) {
          case "list": {
            const agents = projectStore.listAgents().map(summarize);
            return ok(
              action,
              agents.length === 0
                ? "No agents in this project yet."
                : `Agents in this project (${agents.length}):\n${JSON.stringify(agents, null, 2)}`,
            );
          }
          case "get": {
            const agentId = params.agent_id ?? currentAgentId;
            if (!agentId) return fail(action, "`agent_id` is required for `get`.");
            const store = projectStore.getAgent(agentId);
            if (!store) return fail(action, `agent "${agentId}" not found. Use action "list" to see valid ids.`);
            const profile = store.getProfile();
            return ok(
              action,
              JSON.stringify({ ...summarize(profile), systemPrompt: profile.systemPrompt }, null, 2),
              { agentId, slug: profile.slug },
            );
          }
          case "create": {
            const name = params.name?.trim();
            if (!name) return fail(action, "`name` is required for `create`.");
            if (!params.system_prompt?.trim()) {
              return fail(action, "`system_prompt` is required for `create`.");
            }
            const frontmatter: Record<string, unknown> = { name };
            applyOptionalString(frontmatter, "alias", params.alias);
            applyOptionalString(frontmatter, "model", params.model);
            const tools = validateTools(params.tools, knownTools);
            frontmatter.tools = tools ?? [];
            if (params.context && params.context.length > 0) frontmatter.context = params.context;
            applyTimePerception(frontmatter, params.time_perception, Date.now());

            const content = matter.stringify(`\n${params.system_prompt.trim()}\n`, frontmatter);
            const store = await projectStore.createAgent(undefined, content);
            const profile = store.getProfile();
            return ok(
              action,
              `Agent "${profile.name}" created.\n${JSON.stringify(summarize(profile), null, 2)}`,
              { agentId: profile.id, slug: profile.slug },
            );
          }
          case "update": {
            const agentId = params.agent_id ?? currentAgentId;
            if (!agentId) return fail(action, "`agent_id` is required for `update`.");
            const store = projectStore.getAgent(agentId);
            if (!store) return fail(action, `agent "${agentId}" not found. Use action "list" to see valid ids.`);

            const raw = await store.profile.getRawContent();
            const parsed = matter(raw);
            const frontmatter: Record<string, unknown> = { ...parsed.data };
            if (params.name !== undefined) {
              const name = params.name.trim();
              if (!name) return fail(action, "`name` must not be empty.");
              frontmatter.name = name;
            }
            applyOptionalString(frontmatter, "alias", params.alias);
            applyOptionalString(frontmatter, "model", params.model);
            const tools = validateTools(params.tools, knownTools);
            if (tools !== undefined) frontmatter.tools = tools;
            if (params.context !== undefined) {
              if (params.context.length > 0) frontmatter.context = params.context;
              else delete frontmatter.context;
            }
            applyTimePerception(frontmatter, params.time_perception, Date.now());
            const body =
              params.system_prompt !== undefined ? `\n${params.system_prompt.trim()}\n` : `\n${parsed.content.trim()}\n`;

            const content = matter.stringify(body, frontmatter);
            const updated = await projectStore.updateAgent(agentId, content);
            const profile = updated.getProfile();
            return ok(
              action,
              `Agent "${profile.name}" updated.\n${JSON.stringify(summarize(profile), null, 2)}`,
              { agentId: profile.id, slug: profile.slug },
            );
          }
        }
      } catch (err) {
        if (err instanceof ValidationError || err instanceof NotFoundError) {
          return fail(action, err.message);
        }
        return fail(action, (err as Error).message);
      }
    },
  };
}
