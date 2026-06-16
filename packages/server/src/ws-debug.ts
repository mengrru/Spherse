import { Writable } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";

const clients = new Set<WebSocket>();

export function handleDebugWebSocket(
  fastify: FastifyInstance,
): void {
  fastify.get(
    "/ws/debug",
    { websocket: true },
    (socket) => {
      clients.add(socket);
      fastify.log.debug({ clients: clients.size }, "debug ws client connected");

      socket.on("close", () => {
        clients.delete(socket);
        fastify.log.debug({ clients: clients.size }, "debug ws client disconnected");
      });
    },
  );
}

export function createDebugStream(): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      const line = chunk.toString().trim();
      if (!line) {
        callback();
        return;
      }
      for (const socket of clients) {
        try {
          socket.send(line);
        } catch {
          clients.delete(socket);
        }
      }
      callback();
    },
  });
}
