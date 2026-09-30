export type EventSourceWindow = Pick<WindowProxy, "postMessage">;

export interface EventControlMessage {
  type: "spherse:event-subscribe" | "spherse:event-unsubscribe";
  subscriptionId: string;
  event?: string;
  filter?: unknown;
}

export interface FileUpdateSubscription {
  event: "file:update";
  path: string;
}

export type SdkNavigateEvent =
  | { kind: "welcome" }
  | { kind: "chat"; sessionId: string }
  | { kind: "file"; path: string }
  | { kind: "browser"; url: string };

export interface NavigateSubscription {
  event: "navigate";
}

export type EventSubscription = FileUpdateSubscription | NavigateSubscription;

export interface FileUpdatePushMessage {
  type: "spherse:event";
  event: "file:update";
  subscriptionId: string;
  payload: {
    path: string;
  };
}

export interface NavigatePushMessage {
  type: "spherse:event";
  event: "navigate";
  subscriptionId: string;
  payload: SdkNavigateEvent;
}
