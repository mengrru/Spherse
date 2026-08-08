import { describe, expect, it } from "vitest";
import type { TriggerEntry } from "../../lib/types";
import {
  draftToTriggerData,
  emptyTriggerDraft,
  entryToDraft,
  type TriggerDraft,
} from "./trigger-form-helpers";

function makeEntry(overrides: Partial<TriggerEntry> = {}): TriggerEntry {
  return {
    id: "trig-1",
    type: "time",
    enabled: true,
    mode: "new_session",
    message: "hello",
    notify: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("emptyTriggerDraft", () => {
  it("defaults to a time trigger in a reusable session with no message", () => {
    const draft = emptyTriggerDraft();
    expect(draft.type).toBe("time");
    expect(draft.sessionMode).toBe("reusable_session");
    expect(draft.message).toBe("");
    expect(draft.notify).toBe(false);
    expect(draft.id).toBeTruthy();
  });

  it("returns an independent draft each call", () => {
    expect(emptyTriggerDraft().id).not.toBe(emptyTriggerDraft().id);
  });
});

describe("entryToDraft", () => {
  it("maps all fields from an entry, falling back to empty strings for optionals", () => {
    const draft = entryToDraft(makeEntry({ cron: "0 * * * *", name: "hourly" }));
    expect(draft).toMatchObject({
      id: "trig-1",
      type: "time",
      name: "hourly",
      cron: "0 * * * *",
      eventName: "",
      message: "hello",
      sessionMode: "new_session",
      targetSessionId: "",
      notify: false,
      notificationMessage: "",
    });
  });

  it("preserves event fields and existing-session binding", () => {
    const draft = entryToDraft(
      makeEntry({
        type: "event",
        eventName: "content.saved",
        mode: "existing_session",
        targetSessionId: "sess-9",
        notify: true,
        notificationMessage: "done",
      }),
    );
    expect(draft.type).toBe("event");
    expect(draft.eventName).toBe("content.saved");
    expect(draft.cron).toBe("");
    expect(draft.sessionMode).toBe("existing_session");
    expect(draft.targetSessionId).toBe("sess-9");
    expect(draft.notify).toBe(true);
    expect(draft.notificationMessage).toBe("done");
  });

  it("preserves the bound session for reusable_session mode", () => {
    const draft = entryToDraft(
      makeEntry({ mode: "reusable_session", boundSessionId: "bound-1" }),
    );
    expect(draft.sessionMode).toBe("reusable_session");
    expect(draft.boundSessionId).toBe("bound-1");
  });
});

describe("draftToTriggerData", () => {
  function base(overrides: Partial<TriggerDraft> = {}): TriggerDraft {
    return { ...emptyTriggerDraft(), sessionMode: "new_session", cron: "0 * * * *", message: "go", ...overrides };
  }

  it("returns null when the message is blank", () => {
    expect(draftToTriggerData(base({ message: "   " }))).toBeNull();
  });

  it("returns null for a time trigger without a cron expression", () => {
    expect(draftToTriggerData(base({ type: "time", cron: "" }))).toBeNull();
  });

  it("returns null for an event trigger without an event name", () => {
    expect(draftToTriggerData(base({ type: "event", eventName: "  " }))).toBeNull();
  });

  it("returns null when binding an existing session without a target session id", () => {
    expect(
      draftToTriggerData(base({ sessionMode: "existing_session", targetSessionId: "" })),
    ).toBeNull();
  });

  it("builds time-trigger data, trimming fields and omitting blanks", () => {
    const data = draftToTriggerData(
      base({ type: "time", cron: "  0 9 * * *  ", name: "  daily  " }),
    );
    expect(data).toEqual({
      type: "time",
      cron: "0 9 * * *",
      mode: "new_session",
      message: "go",
      notify: false,
      name: "daily",
    });
    expect(data).not.toHaveProperty("eventName");
    expect(data).not.toHaveProperty("targetSessionId");
    expect(data).not.toHaveProperty("notificationMessage");
  });

  it("omits name when it is blank or only whitespace", () => {
    expect(draftToTriggerData(base({ name: "   " }))).not.toHaveProperty("name");
    expect(draftToTriggerData(base({ name: "" }))).not.toHaveProperty("name");
  });

  it("trims leading/trailing whitespace from the saved message", () => {
    const data = draftToTriggerData(base({ message: "  go now  " }));
    expect(data?.message).toBe("go now");
  });

  it("includes targetSessionId only for existing_session mode", () => {
    const data = draftToTriggerData(
      base({ sessionMode: "existing_session", targetSessionId: "sess-1" }),
    );
    expect(data?.targetSessionId).toBe("sess-1");
  });

  it("drops targetSessionId for new_session mode even if the field has a value", () => {
    const data = draftToTriggerData(
      base({ sessionMode: "new_session", targetSessionId: "stale" }),
    );
    expect(data).not.toHaveProperty("targetSessionId");
  });

  it("drops targetSessionId and never sends boundSessionId for reusable_session mode", () => {
    const data = draftToTriggerData(
      base({ sessionMode: "reusable_session", targetSessionId: "stale", boundSessionId: "bound-1" }),
    );
    expect(data?.mode).toBe("reusable_session");
    expect(data).not.toHaveProperty("targetSessionId");
    expect(data).not.toHaveProperty("boundSessionId");
  });

  it("includes notificationMessage only when notify is on and the message is non-blank", () => {
    expect(
      draftToTriggerData(base({ notify: true, notificationMessage: "  ping  " }))
        ?.notificationMessage,
    ).toBe("ping");
    expect(
      draftToTriggerData(base({ notify: true, notificationMessage: "  " })),
    ).not.toHaveProperty("notificationMessage");
    expect(draftToTriggerData(base({ notify: false, notificationMessage: "ping" }))).not.toHaveProperty(
      "notificationMessage",
    );
  });
});
