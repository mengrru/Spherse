import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("agent schedule feature structure", () => {
  it("keeps the schedule websocket at project layout level instead of the dialog", () => {
    const dialogSource = readFileSync(join(currentDir, "index.tsx"), "utf8");
    const layoutSource = readFileSync(join(currentDir, "../../layouts/ProjectScope.tsx"), "utf8");

    expect(dialogSource).not.toContain("createScheduleWebSocket");
    expect(layoutSource).toContain("createScheduleWebSocket");
  });

  it("shows schedule notification toast from the project-level websocket handler", () => {
    const layoutSource = readFileSync(join(currentDir, "../../layouts/ProjectScope.tsx"), "utf8");

    expect(layoutSource).toContain('import { toast } from "sonner"');
    expect(layoutSource).toContain("showScheduleNotification");
    expect(layoutSource).toContain('event.type === "schedule_completed"');
    expect(layoutSource).toContain("toast.success");
    expect(layoutSource).toContain("notificationMessage");
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
    expect(source).toContain('className="size-6"');
    expect(source.indexOf("onTrigger(entry)")).toBeGreaterThan(-1);
    expect(source.indexOf("onTrigger(entry)")).toBeLessThan(source.indexOf("onEdit(entry)"));
  });

  it("places the create button at the right side of the tab row", () => {
    const dialogSource = readFileSync(join(currentDir, "index.tsx"), "utf8");
    const listSource = readFileSync(join(currentDir, "ScheduleList.tsx"), "utf8");

    expect(dialogSource).toContain("PlusIcon");
    expect(dialogSource).toContain('`${t("agent-schedule.dialogTitle")} | ${agentName}`');
    expect(dialogSource).toContain('className="mb-3 flex items-center justify-between"');
    expect(dialogSource).toContain("<TabsList>");
    expect(dialogSource).toContain('size="default"');
    expect(dialogSource).toContain('t("agent-schedule.createSchedule")');
    expect(listSource).not.toContain("onCreate");
    expect(listSource).not.toContain('t("common.create")');
    expect(listSource).not.toContain('t("common.add")');
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

  it("keeps the message field before frequency and uses a taller textarea", () => {
    const source = readFileSync(join(currentDir, "ScheduleForm.tsx"), "utf8");

    expect(source.indexOf('t("agent-schedule.message")')).toBeLessThan(source.indexOf('t("agent-schedule.frequency")'));
    expect(source).toContain("rows={10}");
  });

  it("shows the scheduler granularity hint near the frequency controls", () => {
    const source = readFileSync(join(currentDir, "ScheduleForm.tsx"), "utf8");

    expect(source).toContain('t("agent-schedule.granularityHint")');
    expect(source.indexOf('t("agent-schedule.frequency")')).toBeLessThan(source.indexOf('t("agent-schedule.granularityHint")'));
  });

  it("localizes schedule preset labels instead of storing Chinese display strings", () => {
    const constantsSource = readFileSync(join(currentDir, "constants.ts"), "utf8");
    const formSource = readFileSync(join(currentDir, "ScheduleForm.tsx"), "utf8");
    const dialogSource = readFileSync(join(currentDir, "index.tsx"), "utf8");

    expect(constantsSource).toContain("labelKey");
    expect(constantsSource).toContain('id: "every-30-minutes"');
    expect(constantsSource).not.toContain("每 30 分钟");
    expect(constantsSource).not.toContain("自定义");
    expect(formSource).toContain("t(p.labelKey)");
    expect(formSource).not.toContain("p.label}</SelectItem>");
    expect(formSource).not.toContain("key={p.label}");
    expect(formSource).not.toContain("value={p.label}");
    expect(formSource).not.toContain('preset === "自定义"');
    expect(dialogSource).toContain("p.id === value");
  });

  it("shows notification controls last with a 30 character custom message limit", () => {
    const source = readFileSync(join(currentDir, "ScheduleForm.tsx"), "utf8");

    expect(source).toContain("notify");
    expect(source).toContain("notificationMessage");
    expect(source).toContain("maxLength={30}");
    expect(source.indexOf('t("agent-schedule.notify")')).toBeGreaterThan(source.indexOf('t("agent-schedule.frequency")'));
  });
});
