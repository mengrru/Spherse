import path from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple, getModel } from "@mariozechner/pi-ai";
import type { AgentEvent, AgentTool } from "@mariozechner/pi-agent-core";
import type { AgentDefinition } from "./types.js";
import { SUPPORTED_PROVIDERS } from "./types.js";
import { ProjectStore } from "./project-store.js";
import { SessionStore } from "./session-store.js";
import { listAgents } from "./agent-parser.js";
import {
  createToolsForProject,
  getDefaultToolsForAgentType,
} from "./tools/index.js";

export type AgentEventHandler = (event: AgentEvent) => void;

export class AgentEngine {
  private projectStore: ProjectStore;
  private sessionStore: SessionStore;
  private activeSessions: Map<string, Agent> = new Map();

  constructor(projectStore: ProjectStore, sessionStore: SessionStore) {
    this.projectStore = projectStore;
    this.sessionStore = sessionStore;
  }

  async listAgents(): Promise<AgentDefinition[]> {
    const config = this.projectStore.getConfig();
    if (!config) throw new Error("Project not opened");
    const agentDir = path.join(
      this.projectStore.getRootPath(),
      ".pi",
      config.paths.agents,
    );
    return listAgents(agentDir);
  }

  async createSession(agentName: string): Promise<string> {
    const definition = await this.findAgentDefinition(agentName);
    if (!definition) throw new Error(`Agent "${agentName}" not found`);

    const sessionId = this.sessionStore.createSession(agentName);
    const agent = await this.buildAgent(definition, sessionId);
    this.activeSessions.set(sessionId, agent);
    return sessionId;
  }

  async restoreSession(sessionId: string): Promise<string> {
    if (this.activeSessions.has(sessionId)) return sessionId;

    const session = this.sessionStore.getSession(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);

    const definition = await this.findAgentDefinition(session.agentName);
    if (!definition)
      throw new Error(`Agent "${session.agentName}" not found`);

    const agent = await this.buildAgent(definition, sessionId);
    agent.state.messages = this.sessionStore.getSessionMessages(sessionId);
    this.activeSessions.set(sessionId, agent);
    return sessionId;
  }

  async sendMessage(
    sessionId: string,
    message: string,
    onEvent: AgentEventHandler,
  ): Promise<void> {
    const agent = this.activeSessions.get(sessionId);
    if (!agent) throw new Error(`No active session "${sessionId}"`);

    const unsubscribe = agent.subscribe((event) => {
      onEvent(event);
      if (event.type === "message_end") {
        this.sessionStore.appendMessage(sessionId, event.message);
      }
    });

    try {
      await agent.prompt(message);
    } finally {
      unsubscribe();
    }
  }

  destroySession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
  }

  hasActiveSession(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  getSessionHistory(sessionId: string): any[] {
    return this.sessionStore.getSessionMessages(sessionId);
  }

  abortSession(sessionId: string): void {
    const agent = this.activeSessions.get(sessionId);
    if (agent) agent.abort();
  }

  private async findAgentDefinition(
    agentName: string,
  ): Promise<AgentDefinition | undefined> {
    const agents = await this.listAgents();
    return agents.find((a) => a.name === agentName);
  }

  private async buildAgent(
    definition: AgentDefinition,
    sessionId: string,
  ): Promise<Agent> {
    const config = this.projectStore.getConfig()!;
    const projectRoot = this.projectStore.getRootPath();
    const allTools = createToolsForProject(
      projectRoot,
      config.paths.changelog,
    );

    const toolNames =
      definition.tools ?? getDefaultToolsForAgentType(definition.type);
    const tools: AgentTool[] = toolNames
      .map((name) => allTools[name])
      .filter(Boolean);

    const agentsMd = await this.projectStore.readIndex();
    const systemPrompt = `${agentsMd}\n\n---\n\n${definition.systemPrompt}`;

    const modelId = definition.model ?? config.defaultModel;
    const model = this.resolveModel(modelId);

    return new Agent({
      initialState: {
        systemPrompt,
        model,
        thinkingLevel: "medium",
        tools,
      },
      sessionId,
      streamFn: async (model, context, options) => {
        return streamSimple(model, context, options);
      },
    });
  }

  private resolveModel(modelId: string): any {
    const providers: string[] = [
      ...Object.keys(SUPPORTED_PROVIDERS),
      "google",
      "anthropic",
      "openai",
    ];
    for (const provider of providers) {
      try {
        return (getModel as any)(provider, modelId);
      } catch {
        continue;
      }
    }
    throw new Error(`Could not resolve model: ${modelId}`);
  }
}
