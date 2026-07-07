import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("agent schedule feature structure", () => {
  it("keeps the schedule websocket at project layout level instead of the dialog", () => {
    const dialogSource = readFileSync(join(currentDir, "index.tsx"), "utf8");
    const bridgeSource = readFileSync(join(currentDir, "ScheduleEventBridge.tsx"), "utf8");

    expect(dialogSource).not.toContain("useBusSubscription");
    expect(bridgeSource).toContain('useBusSubscription(projectId ?? "", "schedule"');
  });

  it("shows schedule notification toast from the project-level websocket handler", () => {
    const bridgeSource = readFileSync(join(currentDir, "ScheduleEventBridge.tsx"), "utf8");

    expect(bridgeSource).toContain('import { toast } from "sonner"');
    expect(bridgeSource).toContain("showScheduleNotification");
    expect(bridgeSource).toContain('type === "schedule_completed"');
    expect(bridgeSource).toContain("toast.success");
    expect(bridgeSource).toContain("notificationMessage");
  });

  it("uses stable empty array fallbacks for schedule store selectors", () => {
    const dialogSource = readFileSync(join(currentDir, "index.tsx"), "utf8");
    const constantsSource = readFileSync(join(currentDir, "constants.ts"), "utf8");

    expect(constantsSource).toContain("EMPTY_RUNNING_SCHEDULE_IDS");
    expect(dialogSource).not.toContain("?? []");
    expect(dialogSource).toContain("EMPTY_RUNNING_SCHEDULE_IDS");
  });

  it("renders the manual trigger button before the edit button", () => {
    const source = readFileSync(join(currentDir, "ScheduleList.tsx"), "utf8");

    expect(source).toContain("onTrigger");
    expect(source).toContain("runningScheduleIds");
    expect(source).toContain("LoaderCircleIcon");
    expect(source.indexOf("onTrigger(entry)")).toBeLessThan(source.indexOf("onEdit(entry)"));
  });

  it("places the create button at the right side of the tab row", () => {
    const dialogSource = readFileSync(join(currentDir, "index.tsx"), "utf8");
    const listSource = readFileSync(join(currentDir, "ScheduleList.tsx"), "utf8");

    expect(dialogSource).toContain("PlusIcon");
    expect(dialogSource).toContain('`${t("agent-schedule.dialogTitle")} | ${agentName}`');
    expect(dialogSource).toContain("<TabsList>");
    expect(dialogSource).toContain('t("agent-schedule.createSchedule")');
    expect(listSource).not.toContain("onCreate");
  });

  it("shows schedule logs by reversing the API order", () => {
    const source = readFileSync(join(currentDir, "ScheduleLogs.tsx"), "utf8");

    expect(source).toContain("displayLogs");
    expect(source).toContain("[...logs].reverse()");
    expect(source).not.toContain("b.triggeredAt - a.triggeredAt");
  });

  it("shows completion timestamps for completed schedule logs", () => {
    const source = readFileSync(join(currentDir, "ScheduleLogs.tsx"), "utf8");

    expect(source).toContain("log.completedAt ?? log.triggeredAt");
    expect(source).not.toContain("new Date(log.triggeredAt)");
  });

  it("keeps the message field before frequency", () => {
    const source = readFileSync(join(currentDir, "ScheduleForm.tsx"), "utf8");

    expect(source.indexOf('t("agent-schedule.message")')).toBeLessThan(source.indexOf('t("agent-schedule.frequency")'));
  });

  it("shows the scheduler granularity hint near the frequency controls", () => {
    const source = readFileSync(join(currentDir, "ScheduleForm.tsx"), "utf8");

    expect(source).toContain('t("agent-schedule.granularityHint")');
    expect(source.indexOf('t("agent-schedule.frequency")')).toBeLessThan(source.indexOf('t("agent-schedule.granularityHint")'));
  });

  it("renders cron templates as buttons that fill the cron input instead of a preset select", () => {
    const constantsSource = readFileSync(join(currentDir, "constants.ts"), "utf8");
    const formSource = readFileSync(join(currentDir, "ScheduleForm.tsx"), "utf8");
    const dialogSource = readFileSync(join(currentDir, "index.tsx"), "utf8");

    expect(constantsSource).toContain("labelKey");
    expect(constantsSource).toContain('id: "every-30-minutes"');
    expect(constantsSource).not.toContain("每 30 分钟");
    expect(constantsSource).not.toContain("自定义");
    expect(constantsSource).not.toContain('id: "custom"');
    // template buttons localize labels and fill the free-text cron input
    expect(formSource).toContain("t(p.labelKey)");
    expect(formSource).toContain("onCronChange(p.cron)");
    expect(formSource).not.toContain("<Select");
    expect(formSource).not.toContain("</SelectContent>");
    expect(formSource).toContain('t("agent-schedule.cronPlaceholder")');
    // dialog no longer maps preset ids to cron
    expect(dialogSource).not.toContain("handlePresetChange");
    expect(dialogSource).not.toContain("p.id === value");
  });

  it("lets users pick a session mode and bind an existing session id", () => {
    const formSource = readFileSync(join(currentDir, "ScheduleForm.tsx"), "utf8");
    const reducerSource = readFileSync(join(currentDir, "schedule-form-reducer.ts"), "utf8");
    const dialogSource = readFileSync(join(currentDir, "index.tsx"), "utf8");

    expect(reducerSource).toContain("sessionMode");
    expect(reducerSource).toContain("targetSessionId");
    expect(reducerSource).toContain("sessionMode: action.entry.mode");
    expect(reducerSource).toContain('sessionMode: "new_session"');
    expect(formSource).toContain("onSessionModeChange");
    expect(formSource).toContain("onTargetSessionIdChange");
    expect(formSource).toContain('"agent-schedule.modeNewSession"');
    expect(formSource).toContain('"agent-schedule.modeExistingSession"');
    expect(dialogSource).toContain("mode: form.sessionMode");
    expect(dialogSource).toContain("form.sessionMode === \"existing_session\"");
  });

  it("shows notification controls last with a 30 character custom message limit", () => {
    const source = readFileSync(join(currentDir, "ScheduleForm.tsx"), "utf8");

    expect(source).toContain("notify");
    expect(source).toContain("notificationMessage");
    expect(source).toContain("maxLength={30}");
    expect(source.indexOf('t("agent-schedule.notify")')).toBeGreaterThan(source.indexOf('t("agent-schedule.frequency")'));
  });
});
