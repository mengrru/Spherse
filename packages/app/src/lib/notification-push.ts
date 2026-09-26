export type PushSetupState =
  | "unsupported"
  | "no-connection"
  | "unavailable"
  | "granted"
  | "prompt"
  | "denied";

export interface PushSetupInput {
  hasConnection: boolean;
  supported: boolean;
  pushAvailable: boolean;
  permission: NotificationPermission;
}

export function resolvePushSetupState(input: PushSetupInput): PushSetupState {
  if (!input.supported) return "unsupported";
  if (!input.hasConnection) return "no-connection";
  if (!input.pushAvailable) return "unavailable";
  if (input.permission === "granted") return "granted";
  if (input.permission === "denied") return "denied";
  return "prompt";
}

export interface SubscriptionKeyState {
  existingEndpoint: string | null;
  existingKeyBytes: Uint8Array | null;
  expectedKeyBytes: Uint8Array;
}

export function needsNewSubscription(state: SubscriptionKeyState): boolean {
  if (!state.existingEndpoint) return true;
  if (!state.existingKeyBytes || state.existingKeyBytes.length === 0) return true;
  if (state.existingKeyBytes.length !== state.expectedKeyBytes.length) return true;
  return !state.existingKeyBytes.every((byte, index) => byte === state.expectedKeyBytes[index]);
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}
