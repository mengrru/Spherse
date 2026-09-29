import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { createProject, type ProjectRuntime, type Logger, type AgentChangePayload } from "@spherse/core";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
};
import { registerAgentMcpRoutes } from "../routes/agent-mcp.js";
import type { ProjectRegistry } from "../registry.js";

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: { projectManager: import("@spherse/core").ProjectManager; runtime: ProjectRuntime };
  }
}

describe("agent mcp facade contract: real ProjectRuntime through real routes", () => {
  let tmpDir: string;
  let runtime: ProjectRuntime;
  let app: FastifyInstance;
  let agentId: string;
  let agentDir: string;
  let changes: AgentChangePayload[];

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-mcp-contract-"));
    runtime = await createProject(tmpDir, { projectName: "Contract", logger: silentLogger });
    const created = await runtime.projectManager.createAgent(
      "contract-agent",
      "---\nname: Contract Agent\n---\nbody",
    );
    agentId = created.id;
    agentDir = path.join(tmpDir, ".spherse/agents", created.slug);
    runtime.timerService.stop();

    changes = [];
    runtime.projectManager.projectStore.on("agent_updated", (payload: AgentChangePayload) => {
      changes.push(payload);
    });

    app = Fastify();
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = { projectManager: runtime.projectManager, runtime };
    });
    registerAgentMcpRoutes(app, {} as ProjectRegistry);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await runtime.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("PUT /mcp persists through the runtime facade and broadcasts agent_updated", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/p1/agents/${agentId}/mcp`,
      payload: {
        servers: [
          { id: "s1", name: "fs", enabled: true, transport: "stdio", command: "npx" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { servers: Array<{ id: string }> };
    expect(body.servers).toHaveLength(1);

    const stored = JSON.parse(
      fs.readFileSync(path.join(agentDir, "mcp.json"), "utf-8"),
    ) as { servers: Array<{ id: string }> };
    expect(stored.servers[0].id).toBe("s1");

    expect(changes).toContainEqual({ agentId, action: "updated" });
  });

  it("GET /mcp reads back the saved config", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/p1/agents/${agentId}/mcp`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { servers: Array<{ id: string; transport: string }> };
    expect(body.servers[0].id).toBe("s1");
    expect(body.servers[0].transport).toBe("stdio");
  });

  it("PUT /mcp rejects the removed sse transport with 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/p1/agents/${agentId}/mcp`,
      payload: {
        servers: [{ id: "s2", name: "old", enabled: true, transport: "sse", url: "https://x/sse" }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT /mcp for a missing agent maps to 404", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/projects/p1/agents/nope/mcp",
      payload: { servers: [] },
    });
    expect(res.statusCode).toBe(404);
  });
});
