import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "./index.js";
import { PROJECT_META_DIR } from "@spherse/core";

export function handleFsWatchWebSocket(
  fastify: FastifyInstance,
  ctx: AppContext,
) {
  fastify.get(
    "/ws/fs-watch",
    { websocket: true },
    (socket) => {
      const projectRoot = ctx.projectStore.getRootPath();
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
