import { Type, type Static } from "@sinclair/typebox";
import { parseContract } from "./common.js";

const pushEndpoint = Type.String({
  minLength: "https://x".length,
  pattern: "^https://.+",
});

const pushSubscriptionKeys = Type.Object({
  p256dh: Type.String({ minLength: 1 }),
  auth: Type.String({ minLength: 1 }),
});

export const pushSubscribeRequest = Type.Object({
  endpoint: pushEndpoint,
  keys: pushSubscriptionKeys,
  locale: Type.String({ minLength: 1 }),
});

export const pushUnsubscribeRequest = Type.Object({
  endpoint: pushEndpoint,
});

const pushNotificationKind = Type.Union([
  Type.Literal("approval"),
  Type.Literal("trigger_completed"),
  Type.Literal("trigger_failed"),
]);

export const pushNotificationPayload = Type.Object({
  title: Type.String(),
  body: Type.String(),
  tag: Type.String(),
  data: Type.Object({
    kind: pushNotificationKind,
    projectId: Type.String(),
    sessionId: Type.Optional(Type.String()),
  }),
});

export const pushAvailability = Type.Object({
  publicKey: Type.String({ minLength: 1 }),
});

export const schemas = {
  pushSubscribeRequest,
  pushUnsubscribeRequest,
  pushNotificationPayload,
  pushAvailability,
} as const;

export type PushSubscribeRequest = Static<typeof pushSubscribeRequest>;
export type PushUnsubscribeRequest = Static<typeof pushUnsubscribeRequest>;
export type PushNotificationPayload = Static<typeof pushNotificationPayload>;
export type PushAvailability = Static<typeof pushAvailability>;

export function parsePushSubscribeRequest(payload: unknown): PushSubscribeRequest {
  return parseContract(pushSubscribeRequest, payload);
}

export function parsePushUnsubscribeRequest(payload: unknown): PushUnsubscribeRequest {
  return parseContract(pushUnsubscribeRequest, payload);
}
