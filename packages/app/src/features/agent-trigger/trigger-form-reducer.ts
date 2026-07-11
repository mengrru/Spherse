import type { TriggerEntry } from "../../lib/types";

export type TriggerFormFields = {
  type: "time" | "event";
  cron: string;
  eventName: string;
  message: string;
  name: string;
  sessionMode: "new_session" | "existing_session";
  targetSessionId: string;
  notify: boolean;
  notificationMessage: string;
};

export type TriggerFormState = {
  mode: "idle" | "create" | "edit";
  editingId: string | null;
} & TriggerFormFields;

export type TriggerFormAction =
  | { type: "startCreate" }
  | { type: "edit"; entry: TriggerEntry }
  | { type: "patch"; patch: Partial<TriggerFormFields> }
  | { type: "reset" };

export const NEW_TRIGGER_ID = "__new__";

export const EMPTY_FORM_FIELDS: TriggerFormFields = {
  type: "time",
  cron: "",
  eventName: "",
  message: "",
  name: "",
  sessionMode: "new_session",
  targetSessionId: "",
  notify: false,
  notificationMessage: "",
};

export const IDLE_FORM_STATE: TriggerFormState = {
  mode: "idle",
  editingId: null,
  ...EMPTY_FORM_FIELDS,
};

export function triggerFormReducer(
  state: TriggerFormState,
  action: TriggerFormAction,
): TriggerFormState {
  switch (action.type) {
    case "startCreate":
      return { mode: "create", editingId: NEW_TRIGGER_ID, ...EMPTY_FORM_FIELDS };
    case "edit":
      return {
        mode: "edit",
        editingId: action.entry.id,
        type: action.entry.type,
        cron: action.entry.cron ?? "",
        eventName: action.entry.eventName ?? "",
        message: action.entry.message,
        name: action.entry.name ?? "",
        sessionMode: action.entry.mode,
        targetSessionId: action.entry.targetSessionId ?? "",
        notify: action.entry.notify,
        notificationMessage: action.entry.notificationMessage ?? "",
      };
    case "patch":
      return { ...state, ...action.patch };
    case "reset":
      return IDLE_FORM_STATE;
  }
}
