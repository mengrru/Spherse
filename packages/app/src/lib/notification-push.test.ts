import { describe, expect, it } from "vitest";
import {
  needsNewSubscription,
  resolvePushSetupState,
  urlBase64ToUint8Array,
  type PushSetupInput,
} from "./notification-push";

const base: PushSetupInput = {
  hasConnection: true,
  supported: true,
  pushAvailable: true,
  permission: "default",
};

describe("resolvePushSetupState", () => {
  it("returns unsupported when push APIs are missing", () => {
    expect(resolvePushSetupState({ ...base, supported: false })).toBe("unsupported");
  });

  it("returns no-connection before probing the server", () => {
    expect(resolvePushSetupState({ ...base, hasConnection: false })).toBe("no-connection");
  });

  it("returns unavailable when server push is disabled", () => {
    expect(resolvePushSetupState({ ...base, pushAvailable: false })).toBe("unavailable");
  });

  it("maps notification permission to granted/prompt/denied", () => {
    expect(resolvePushSetupState({ ...base, permission: "granted" })).toBe("granted");
    expect(resolvePushSetupState({ ...base, permission: "default" })).toBe("prompt");
    expect(resolvePushSetupState({ ...base, permission: "denied" })).toBe("denied");
  });
});

describe("needsNewSubscription", () => {
  const expected = new Uint8Array([1, 2, 3]);

  it("requires a subscription when none exists", () => {
    expect(
      needsNewSubscription({ existingEndpoint: null, existingKeyBytes: null, expectedKeyBytes: expected }),
    ).toBe(true);
  });

  it("requires a subscription when the recorded key is missing", () => {
    expect(
      needsNewSubscription({ existingEndpoint: "https://x", existingKeyBytes: null, expectedKeyBytes: expected }),
    ).toBe(true);
  });

  it("requires a subscription when the vapid key changed", () => {
    expect(
      needsNewSubscription({
        existingEndpoint: "https://x",
        existingKeyBytes: new Uint8Array([9, 9, 9]),
        expectedKeyBytes: expected,
      }),
    ).toBe(true);
  });

  it("keeps an existing subscription when keys match", () => {
    expect(
      needsNewSubscription({
        existingEndpoint: "https://x",
        existingKeyBytes: new Uint8Array([1, 2, 3]),
        expectedKeyBytes: expected,
      }),
    ).toBe(false);
  });
});

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url with padding normalization", () => {
    expect(urlBase64ToUint8Array("AQID")).toEqual(new Uint8Array([1, 2, 3]));
    expect(urlBase64ToUint8Array("AQIDBA")).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(urlBase64ToUint8Array("-A")).toEqual(new Uint8Array([248]));
  });
});
