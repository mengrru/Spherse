import type { FastifyInstance } from "fastify";
import type { AppContext } from "./index.js";

export function handleChatWebSocket(
  fastify: FastifyInstance,
  ctx: AppContext,
) {
  fastify.get<{ Params: { sessionId: string } }>(
    "/ws/chat/:sessionId",
    { websocket: true },
    (socket, req) => {
      const { sessionId } = req.params;
      fastify.log.info({ sessionId }, "chat ws connected");

      ctx.engine.restoreSession(sessionId).catch((err) => {
        socket.send(JSON.stringify({ type: "error", message: err.message }));
        socket.close();
      });

      socket.on("message", async (raw: Buffer) => {
        const msg = JSON.parse(raw.toString());

        if (msg.type === "message") {
          try {
            await ctx.engine.sendMessage(sessionId, msg.content, (event) => {
              socket.send(JSON.stringify(event));
            });
            socket.send(JSON.stringify({ type: "agent_end_done" }));
          } catch (err: any) {
            fastify.log.error({ err, sessionId }, "chat ws message error");
            socket.send(
              JSON.stringify({ type: "error", message: err.message }),
            );
          }
        } else if (msg.type === "abort") {
          ctx.engine.abortSession(sessionId);
        }
      });

      socket.on("close", () => {
        fastify.log.info({ sessionId }, "chat ws disconnected");
      });
    },
  );
}
