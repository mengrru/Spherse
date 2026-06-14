import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import type { ProjectRegistry } from "./registry.js";
import { PROJECT_META_DIR } from "@spherse/core";

export function handleFsWatchWebSocket(
  fastify: FastifyInstance,
  registry: ProjectRegistry,
) {
  fastify.get<{ Params: { projectId: string } }>(
    "/ws/projects/:projectId/fs-watch",
    { websocket: true },
    (socket, req) => {
      const ctx = registry.get(req.params.projectId);
      if (!ctx) {
        socket.close();
        return;
      }
      const projectRoot = ctx.projectManager.getRootPath();
      fastify.log.info("fs-watch ws connected");
      let alive = true;

      const watcher = fs.watch(
        projectRoot,
        { recursive: true },
        (eventType, filename) => {
          if (!alive) return;
          if (!filename) return;
          const segs = filename.split(/[/\\]/);
          if (segs[0] === PROJECT_META_DIR) return;
          socket.send(JSON.stringify({ type: "change", eventType, path: filename }));
        },
      );

      watcher.on("error", () => {
        if (alive) socket.close();
      });

      socket.on("close", () => {
        alive = false;
        watcher.close();
        fastify.log.debug("fs-watch ws disconnected");
      });
    },
  );
}
