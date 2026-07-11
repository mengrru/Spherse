import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("agent trigger feature structure", () => {
  it("keeps the trigger websocket at project layout level instead of the dialog", () => {
    const dialogSource = readFileSync(join(currentDir, "index.tsx"), "utf8");
    const bridgeSource = readFileSync(join(currentDir, "TriggerEventBridge.tsx"), "utf8");

    expect(dialogSource).not.toContain("useBusSubscription");
    expect(bridgeSource).toContain('useBusSubscription(projectId ?? "", "trigger"');
  });

  it("shows trigger notification toast from the project-level websocket handler", () => {
    const bridgeSource = readFileSync(join(currentDir, "TriggerEventBridge.tsx"), "utf8");

    expect(bridgeSource).toContain('import { toast } from "sonner"');
    expect(bridgeSource).toContain("showTriggerNotification");
    expect(bridgeSource).toContain('type === "trigger_completed"');
    expect(bridgeSource).toContain("toast.success");
    expect(bridgeSource).toContain("notificationMessage");
  });

  it("uses stable empty array fallbacks for trigger store selectors", () => {
    const dialogSource = readFileSync(join(currentDir, "index.tsx"), "utf8");
    const constantsSource = readFileSync(join(currentDir, "constants.ts"), "utf8");

    expect(constantsSource).toContain("EMPTY_RUNNING_TRIGGER_IDS");
    expect(dialogSource).toContain("EMPTY_RUNNING_TRIGGER_IDS");
  });

  it("renders the manual trigger button before the edit button", () => {
    const source = readFileSync(join(currentDir, "TriggerList.tsx"), "utf8");

    expect(source).toContain("onTrigger");
    expect(source).toContain("runningTriggerIds");
    expect(source).toContain("LoaderCircleIcon");
    expect(source.indexOf("onTrigger(entry)")).toBeLessThan(source.indexOf("onEdit(entry)"));
  });

  it("places the create button at the right side of the tab row", () => {
    const dialogSource = readFileSync(join(currentDir, "index.tsx"), "utf8");
    const listSource = readFileSync(join(currentDir, "TriggerList.tsx"), "utf8");

    expect(dialogSource).toContain("PlusIcon");
    expect(dialogSource).toContain("<TabsList>");
    expect(dialogSource).toContain('t("agent-trigger.createTrigger")');
    expect(listSource).not.toContain("onCreate");
  });

  it("shows trigger logs by reversing the API order", () => {
    const source = readFileSync(join(currentDir, "TriggerLogs.tsx"), "utf8");

    expect(source).toContain("displayLogs");
    expect(source).toContain("[...logs].reverse()");
  });

  it("shows completion timestamps for completed trigger logs", () => {
    const source = readFileSync(join(currentDir, "TriggerLogs.tsx"), "utf8");

    expect(source).toContain("log.completedAt ?? log.triggeredAt");
  });

  it("includes trigger type selector in the form", () => {
    const source = readFileSync(join(currentDir, "TriggerForm.tsx"), "utf8");

    expect(source).toContain('t("agent-trigger.type")');
    expect(source).toContain('"time"');
    expect(source).toContain('"event"');
    expect(source).toContain("onTypeChange");
  });

  it("shows event-specific fields only for event type", () => {
    const source = readFileSync(join(currentDir, "TriggerForm.tsx"), "utf8");

    expect(source).toContain("eventName");
    expect(source).toContain('t("agent-trigger.eventName")');
    expect(source).toContain("payload");
    expect(source).toContain('t("agent-trigger.payloadVarHint")');
  });

  it("lets users pick a session mode and bind an existing session id", () => {
    const formSource = readFileSync(join(currentDir, "TriggerForm.tsx"), "utf8");
    const reducerSource = readFileSync(join(currentDir, "trigger-form-reducer.ts"), "utf8");
    const dialogSource = readFileSync(join(currentDir, "index.tsx"), "utf8");

    expect(reducerSource).toContain("sessionMode");
    expect(reducerSource).toContain("targetSessionId");
    expect(reducerSource).toContain("sessionMode: action.entry.mode");
    expect(reducerSource).toContain('sessionMode: "new_session"');
    expect(formSource).toContain("onSessionModeChange");
    expect(formSource).toContain("onTargetSessionIdChange");
    expect(formSource).toContain('"agent-trigger.modeNewSession"');
    expect(formSource).toContain('"agent-trigger.modeExistingSession"');
    expect(dialogSource).toContain("mode: form.sessionMode");
    expect(dialogSource).toContain("form.sessionMode === \"existing_session\"");
  });
});
