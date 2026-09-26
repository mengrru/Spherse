import type { FastifyInstance } from "fastify";
import { parsePushSubscribeRequest, parsePushUnsubscribeRequest, schemas } from "@spherse/contracts";
import type { PushStore } from "../push/push-store.js";

export interface PushRouteOptions {
  store?: PushStore;
}

export function registerPushRoutes(fastify: FastifyInstance, options: PushRouteOptions): void {
  if (!options.store) return;

  fastify.post<{ Body: unknown }>(
    "/api/push/subscribe",
    {
      schema: { body: schemas.pushSubscribeRequest, response: { 200: schemas.okResponse } },
      async handler(req) {
        const body = parsePushSubscribeRequest(req.body);
        options.store!.upsert({ endpoint: body.endpoint, keys: body.keys, locale: body.locale });
        return { ok: true };
      },
    },
  );

  fastify.post<{ Body: unknown }>(
    "/api/push/unsubscribe",
    {
      schema: { body: schemas.pushUnsubscribeRequest, response: { 200: schemas.okResponse } },
      async handler(req) {
        const body = parsePushUnsubscribeRequest(req.body);
        options.store!.remove(body.endpoint);
        return { ok: true };
      },
    },
  );
}
