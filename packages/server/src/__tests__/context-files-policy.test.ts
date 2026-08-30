import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMultiProjectServer, type MultiProjectServer } from "../index.js";
import { CONTEXT_TOTAL_SIZE_LIMIT_BYTES } from "@spherse/presets";

describe("context files policy through the real server", () => {
  let tmpDir: string;
  let server: MultiProjectServer;
  let projectId: string;
  let baseURL: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-ctx-policy-"));
    fs.mkdirSync(path.join(tmpDir, "notes"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "notes/a.md"), "hello context");
    fs.writeFileSync(path.join(tmpDir, "img.png"), "fakepng");
    fs.writeFileSync(path.join(tmpDir, "big.txt"), "a".repeat(CONTEXT_TOTAL_SIZE_LIMIT_BYTES + 1));
    server = await createMultiProjectServer({ port: 0 });
    const ctx = await server.registry.register(tmpDir);
    projectId = ctx.projectId;
    baseURL = `/api/projects/${projectId}`;
  });

  afterAll(async () => {
    await server.registry.removeAll();
    await server.fastify.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("POST /context-files/inspect", () => {
    it("returns exists/sizeBytes/allowed per requested path", async () => {
      const res = await server.fastify.inject({
        method: "POST",
        url: `${baseURL}/context-files/inspect`,
        payload: { paths: ["notes/a.md", "img.png", "missing.txt", "../../../etc/passwd"] },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        files: Array<{ path: string; exists: boolean; sizeBytes: number; allowed: boolean }>;
      };
      expect(body.files).toEqual([
        { path: "notes/a.md", exists: true, sizeBytes: 13, allowed: true },
        { path: "img.png", exists: true, sizeBytes: 7, allowed: false },
        { path: "missing.txt", exists: false, sizeBytes: 0, allowed: true },
        { path: "../../../etc/passwd", exists: false, sizeBytes: 0, allowed: false },
      ]);
    });

    it("rejects malformed bodies with 400", async () => {
      const res = await server.fastify.inject({
        method: "POST",
        url: `${baseURL}/context-files/inspect`,
        payload: { nope: true },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("agent write contract: context policy enforced by real ProjectStore", () => {
    const profile = (contextPaths: string[]) =>
      `---\nname: Refs\n${contextPaths.length > 0 ? `context:\n${contextPaths.map((p) => `  - ${p}`).join("\n")}\n` : ""}---\n\nYou keep refs.`;

    it("creates an agent whose context respects the policy", async () => {
      const res = await server.fastify.inject({
        method: "POST",
        url: `${baseURL}/agents/create`,
        payload: { slugBase: "refs-ok", content: profile(["notes/a.md"]) },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { ok: boolean }).ok).toBe(true);
    });

    it("rejects creating an agent with a non plain-text context file (400 + message)", async () => {
      const res = await server.fastify.inject({
        method: "POST",
        url: `${baseURL}/agents/create`,
        payload: { slugBase: "refs-bad", content: profile(["img.png"]) },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toContain("img.png");
    });

    it("rejects creating an agent whose context total size exceeds the limit (400)", async () => {
      const res = await server.fastify.inject({
        method: "POST",
        url: `${baseURL}/agents/create`,
        payload: { slugBase: "refs-big", content: profile(["big.txt"]) },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toContain("exceeds");
    });

    it("rejects updating an agent with a violating context (400) but accepts valid updates", async () => {
      const create = await server.fastify.inject({
        method: "POST",
        url: `${baseURL}/agents/create`,
        payload: { slugBase: "refs-edit", content: profile([]) },
      });
      const agentId = (create.json() as { id: string }).id;

      const bad = await server.fastify.inject({
        method: "PUT",
        url: `${baseURL}/agents/${agentId}`,
        payload: { content: profile(["img.png"]) },
      });
      expect(bad.statusCode).toBe(400);

      const good = await server.fastify.inject({
        method: "PUT",
        url: `${baseURL}/agents/${agentId}`,
        payload: { content: profile(["notes/a.md"]) },
      });
      expect(good.statusCode).toBe(200);
    });
  });
});
