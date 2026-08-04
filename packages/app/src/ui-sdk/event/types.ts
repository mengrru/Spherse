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

export interface FileUpdatePushMessage {
  type: "spherse:event";
  event: "file:update";
  subscriptionId: string;
  payload: {
    path: string;
  };
}
