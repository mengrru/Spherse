import { describe, expect, it } from "vitest";
import {
  parsePushNotificationPayload,
  parsePushSubscribeRequest,
  parsePushUnsubscribeRequest,
} from "../index.js";

describe("push contract", () => {
  it("accepts valid subscribe request", () => {
    const body = {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: { p256dh: "key-p256dh", auth: "key-auth" },
      locale: "zh-CN",
    };
    expect(parsePushSubscribeRequest(body)).toEqual(body);
  });

  it("rejects subscribe request with missing keys", () => {
    expect(() =>
      parsePushSubscribeRequest({
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
        keys: { p256dh: "" },
        locale: "zh-CN",
      }),
    ).toThrow(/Invalid payload/);
  });

  it("rejects subscribe request with non-string endpoint", () => {
    expect(() =>
      parsePushSubscribeRequest({
        endpoint: 123,
        keys: { p256dh: "k", auth: "k" },
        locale: "zh-CN",
      }),
    ).toThrow(/Invalid payload/);
  });

  it("accepts valid unsubscribe request", () => {
    const body = { endpoint: "https://fcm.googleapis.com/fcm/send/abc" };
    expect(parsePushUnsubscribeRequest(body)).toEqual(body);
  });

  it("rejects unsubscribe request with empty endpoint", () => {
    expect(() => parsePushUnsubscribeRequest({ endpoint: "" })).toThrow(/Invalid payload/);
  });

  it("accepts notification payload with optional sessionId", () => {
    const payload = {
      title: "t",
      body: "b",
      tag: "approval:req-1",
      data: { kind: "approval", projectId: "p1", sessionId: "s1" },
    };
    expect(parsePushNotificationPayload(payload)).toEqual(payload);
  });

  it("accepts notification payload without sessionId", () => {
    const payload = {
      title: "t",
      body: "b",
      tag: "trigger:t1:123",
      data: { kind: "trigger_failed", projectId: "p1" },
    };
    expect(parsePushNotificationPayload(payload)).toEqual(payload);
  });

  it("rejects notification payload with unknown kind", () => {
    expect(() =>
      parsePushNotificationPayload({
        title: "t",
        body: "b",
        tag: "x",
        data: { kind: "unknown", projectId: "p1" },
      }),
    ).toThrow(/Invalid payload/);
  });
});
