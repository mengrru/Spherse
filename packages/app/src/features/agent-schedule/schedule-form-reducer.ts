import type { ScheduleEntry } from "../../lib/types";

export type ScheduleFormFields = {
  cron: string;
  message: string;
  name: string;
  sessionMode: "new_session" | "existing_session";
  targetSessionId: string;
  notify: boolean;
  notificationMessage: string;
};

export type ScheduleFormState = {
  mode: "idle" | "create" | "edit";
  editingId: string | null;
} & ScheduleFormFields;

export type ScheduleFormAction =
  | { type: "startCreate" }
  | { type: "edit"; entry: ScheduleEntry }
  | { type: "patch"; patch: Partial<ScheduleFormFields> }
  | { type: "reset" };

export const NEW_SCHEDULE_ID = "__new__";

export const EMPTY_FORM_FIELDS: ScheduleFormFields = {
  cron: "",
  message: "",
  name: "",
  sessionMode: "new_session",
  targetSessionId: "",
  notify: false,
  notificationMessage: "",
};

export const IDLE_FORM_STATE: ScheduleFormState = {
  mode: "idle",
  editingId: null,
  ...EMPTY_FORM_FIELDS,
};

export function scheduleFormReducer(
  state: ScheduleFormState,
  action: ScheduleFormAction,
): ScheduleFormState {
  switch (action.type) {
    case "startCreate":
      return { mode: "create", editingId: NEW_SCHEDULE_ID, ...EMPTY_FORM_FIELDS };
    case "edit":
      return {
        mode: "edit",
        editingId: action.entry.id,
        cron: action.entry.cron,
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
