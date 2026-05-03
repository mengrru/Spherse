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

      ctx.agentEngine.restoreSession(sessionId).catch((err) => {
        socket.send(JSON.stringify({ type: "error", message: err.message }));
        socket.close();
      });

      socket.on("message", async (raw: Buffer) => {
        const msg = JSON.parse(raw.toString());

        if (msg.type === "message") {
          try {
            await ctx.agentEngine.sendMessage(sessionId, msg.content, (event) => {
              socket.send(JSON.stringify(event));
            });
            socket.send(JSON.stringify({ type: "agent_end_done" }));
          } catch (err: any) {
            socket.send(
              JSON.stringify({ type: "error", message: err.message }),
            );
          }
        } else if (msg.type === "abort") {
          ctx.agentEngine.abortSession(sessionId);
        }
      });
    },
  );
}
