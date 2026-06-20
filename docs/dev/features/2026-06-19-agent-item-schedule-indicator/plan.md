# Agent Item 定时消息标记 Icon — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 agent 列表项 `AgentRow` 上，为「至少有一条 enabled schedule」的 agent 常驻显示 `Clock` icon + tooltip。

**Architecture:** 在全局 `project-data-store` 的 `projects[projectId]` 下新增派生布尔字段 `hasEnabledSchedulesByAgent`。数据通过两个 chokepoint 写入：(1) `ProjectScope` 在项目打开时 preload；(2) `useScheduleStore.refreshSchedules`（CRUD 主路径）注入同步。`AgentRow` 用 `useProjectCtx()` 拿 `projectId`，从 `useProjectDataStore` 订阅布尔，条件渲染 icon。

**Tech Stack:** React 19 + Zustand + lucide-react + `@spherse/i18n`。测试用 vitest，组件用源码字符串结构断言，store 用 runtime mock 断言。

**Spec:** `docs/dev/features/2026-06-19-agent-item-schedule-indicator/design.md`

---

## File Structure

| 文件 | 改动 | 责任 |
|------|------|------|
| `packages/app/src/stores/project-data-store.ts` | Modify | 新增 `hasEnabledSchedulesByAgent` 字段 + `setHasEnabledSchedules` action |
| `packages/app/src/stores/project-data-store.test.ts` | Modify | 新增字段读写 + 随 `clearProjectData` 清理的测试 |
| `packages/app/src/features/agent-schedule/store.ts` | Modify | 在 `refreshSchedules` 写完 `schedulesByAgent` 后，同步派生布尔到 `project-data-store`（CRUD chokepoint） |
| `packages/app/src/features/agent-schedule/store.test.ts` | Create | 新建：验证 `refreshSchedules` 同步派生布尔到 `project-data-store` |
| `packages/app/src/layouts/ProjectScope.tsx` | Modify | 在 `refreshAgents` 完成后用 `Promise.allSettled` 预载所有 agent 的 schedules |
| `packages/app/src/features/agent-session-list/AgentRow.tsx` | Modify | 订阅派生布尔，条件渲染 `Clock` icon + `title` tooltip |
| `packages/app/src/features/agent-session-list/AgentRow.structure.test.ts` | Modify | 新增 icon 渲染断言 |
| `packages/i18n/src/locales/zh-CN.ts` | Modify | 新增 `agent-schedule.indicatorTooltip`（基准） |
| `packages/i18n/src/locales/zh-TW.ts` | Modify | 新增 `agent-schedule.indicatorTooltip` |
| `packages/i18n/src/locales/en.ts` | Modify | 新增 `agent-schedule.indicatorTooltip` |

---

## Task 1: 在 project-data-store 新增 `hasEnabledSchedulesByAgent` 字段

**Files:**
- Modify: `packages/app/src/stores/project-data-store.ts`
- Modify: `packages/app/src/stores/project-data-store.test.ts`

**Goal:** 增加一个按 projectId 聚合的布尔映射字段，配套 setter action。字段嵌在 `ProjectData` 下，所以 `clearProjectData` 天然连同它一起清空。

- [ ] **Step 1: 写失败测试 — 字段写入 + 读取 + 随 clearProjectData 清理**

在 `packages/app/src/stores/project-data-store.test.ts` 文件末尾（最后一个 `it` 之后、`describe` 闭合之前）追加：

```ts
  it("writes and reads hasEnabledSchedulesByAgent via setHasEnabledSchedules", () => {
    useProjectDataStore.getState().setHasEnabledSchedules("project-1", "agent-a", true);

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledSchedulesByAgent).toEqual({
      "agent-a": true,
    });
  });

  it("clears hasEnabledSchedulesByAgent together with project data", async () => {
    const client = createClient({
      listAgents: vi.fn().mockResolvedValue([createAgent("agent-1")]),
    });
    await useProjectDataStore.getState().refreshAgents("project-1", client);
    useProjectDataStore.getState().setHasEnabledSchedules("project-1", "agent-1", true);

    useProjectDataStore.getState().clearProjectData("project-1");

    expect(useProjectDataStore.getState().projects["project-1"]).toBeUndefined();
  });

  it("isolates hasEnabledSchedulesByAgent between projects", () => {
    useProjectDataStore.getState().setHasEnabledSchedules("project-1", "agent-a", true);
    useProjectDataStore.getState().setHasEnabledSchedules("project-2", "agent-a", false);

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledSchedulesByAgent).toEqual({
      "agent-a": true,
    });
    expect(useProjectDataStore.getState().projects["project-2"]?.hasEnabledSchedulesByAgent).toEqual({
      "agent-a": false,
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --workspace=packages/app -- project-data-store.test.ts`
Expected: FAIL，编译错误 `setHasEnabledSchedules does not exist on type` 或运行时 `useProjectDataStore.getState().setHasEnabledSchedules is not a function`。

- [ ] **Step 3: 在 store 类型加字段**

在 `packages/app/src/stores/project-data-store.ts` 的 `interface ProjectData`（第 5-12 行）末尾追加字段：

```ts
interface ProjectData {
  agents: AgentProfile[];
  sessions: SessionInfo[];
  initialMessageBySessionId: Record<string, string>;
  streamingSessionIds: Set<string>;
  loading: boolean;
  error: string | null;
  hasEnabledSchedulesByAgent: Record<string, boolean>;
}
```

- [ ] **Step 4: 在 `createProjectData()` 初始化字段**

在同一个文件第 35-44 行的 `createProjectData()` 里加上字段初始化：

```ts
function createProjectData(): ProjectData {
  return {
    agents: [],
    sessions: [],
    initialMessageBySessionId: {},
    streamingSessionIds: new Set(),
    loading: false,
    error: null,
    hasEnabledSchedulesByAgent: {},
  };
}
```

- [ ] **Step 5: 在 store 接口加 action 签名**

在 `interface ProjectDataStore`（第 14-33 行）里、`clearProjectData` 之前加：

```ts
  setHasEnabledSchedules: (projectId: string, agentId: string, has: boolean) => void;
  clearProjectData: (projectId: string) => void;
```

- [ ] **Step 6: 加 action 实现**

在 store 实现（第 302-307 行 `clearProjectData` 之前）加：

```ts
  setHasEnabledSchedules(projectId, agentId, has) {
    set((state) => updateProjectData(state, projectId, (project) => ({
      ...project,
      hasEnabledSchedulesByAgent: {
        ...project.hasEnabledSchedulesByAgent,
        [agentId]: has,
      },
    })));
  },

  clearProjectData(projectId) {
```

（保留原有 `clearProjectData` 函数体不变——它删除整个 `projects[projectId]`，新字段天然连带删除。）

- [ ] **Step 7: 跑测试确认通过**

Run: `npm test --workspace=packages/app -- project-data-store.test.ts`
Expected: PASS，全部用例（原有 + 新增 3 条）通过。

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/stores/project-data-store.ts packages/app/src/stores/project-data-store.test.ts
git commit -m "feat: add hasEnabledSchedulesByAgent field to project-data-store"
```

---

## Task 2: CRUD chokepoint — `useScheduleStore.refreshSchedules` 同步派生布尔

**Files:**
- Modify: `packages/app/src/features/agent-schedule/store.ts`
- Create: `packages/app/src/features/agent-schedule/store.test.ts`

**Goal:** 让所有 CRUD 路径（create/update/delete 都 await `refreshSchedules`）在拉到最新 schedules 后，把派生布尔也写到 `project-data-store`。`useScheduleStore` 已经 import 了 `useProjectDataStore`（store.ts:4）并在 `handleScheduleEvent` 里调过它的 action（store.ts:139），沿用同一惯例。

- [ ] **Step 1: 写失败测试 — refreshSchedules 同步派生布尔**

新建 `packages/app/src/features/agent-schedule/store.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../lib/api";
import type { ScheduleInfo } from "../../lib/types";
import { useScheduleStore } from "./store";
import { useProjectDataStore } from "../../stores/project-data-store";

function makeSchedule(overrides: Partial<ScheduleInfo>): ScheduleInfo {
  return {
    id: "sch-1",
    enabled: false,
    cron: "0 9 * * *",
    mode: "new_session",
    message: "hi",
    notify: false,
    createdAt: 1,
    updatedAt: 1,
    nextTriggerAt: null,
    ...overrides,
  } as ScheduleInfo;
}

function createClient(listSchedulesReturn: ScheduleInfo[]): ApiClient {
  return {
    listSchedules: vi.fn().mockResolvedValue(listSchedulesReturn),
    createSchedule: vi.fn().mockResolvedValue(undefined),
    updateSchedule: vi.fn().mockResolvedValue(undefined),
    deleteSchedule: vi.fn().mockResolvedValue(undefined),
    triggerSchedule: vi.fn().mockResolvedValue(undefined),
    createScheduleWebSocket: vi.fn(),
  } as unknown as ApiClient;
}

describe("useScheduleStore", () => {
  beforeEach(() => {
    useScheduleStore.setState({ byProject: {} });
    useProjectDataStore.setState({ projects: {} });
  });

  it("writes hasEnabledSchedules=true to project-data-store when refreshSchedules finds an enabled schedule", async () => {
    const client = createClient([makeSchedule({ enabled: true })]);

    await useScheduleStore.getState().refreshSchedules("project-1", client, "agent-1");

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledSchedulesByAgent?.["agent-1"]).toBe(true);
  });

  it("writes hasEnabledSchedules=false when all schedules are disabled", async () => {
    const client = createClient([makeSchedule({ enabled: false }), makeSchedule({ id: "sch-2", enabled: false })]);

    await useScheduleStore.getState().refreshSchedules("project-1", client, "agent-1");

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledSchedulesByAgent?.["agent-1"]).toBe(false);
  });

  it("writes hasEnabledSchedules=false when there are no schedules", async () => {
    const client = createClient([]);

    await useScheduleStore.getState().refreshSchedules("project-1", client, "agent-1");

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledSchedulesByAgent?.["agent-1"]).toBe(false);
  });

  it("does not write to project-data-store when listSchedules rejects", async () => {
    const client = createClient([]);
    (client.listSchedules as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));

    await useScheduleStore.getState().refreshSchedules("project-1", client, "agent-1");

    const project = useProjectDataStore.getState().projects["project-1"];
    expect(project?.hasEnabledSchedulesByAgent?.["agent-1"]).toBeUndefined();
  });

  it("propagates hasEnabled through createSchedule (CRUD chokepoint)", async () => {
    const client = createClient([makeSchedule({ enabled: true })]);

    await useScheduleStore.getState().createSchedule("project-1", client, "agent-1", {} as never);

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledSchedulesByAgent?.["agent-1"]).toBe(true);
  });

  it("propagates hasEnabled through updateSchedule (CRUD chokepoint)", async () => {
    const client = createClient([makeSchedule({ enabled: false })]);

    await useScheduleStore.getState().updateSchedule("project-1", client, "agent-1", "sch-1", {} as never);

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledSchedulesByAgent?.["agent-1"]).toBe(false);
  });

  it("propagates hasEnabled through deleteSchedule (CRUD chokepoint)", async () => {
    const client = createClient([]);

    await useScheduleStore.getState().deleteSchedule("project-1", client, "agent-1", "sch-1");

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledSchedulesByAgent?.["agent-1"]).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --workspace=packages/app -- agent-schedule/store.test.ts`
Expected: FAIL — 前 3 条 + chokepoint 3 条失败，`hasEnabledSchedulesByAgent` 全部 `undefined`（refreshSchedules 还没同步到 project-data-store）。最后 1 条（reject）应已通过。

- [ ] **Step 3: 注入同步逻辑到 refreshSchedules**

在 `packages/app/src/features/agent-schedule/store.ts` 的 `refreshSchedules`（第 73-83 行）改写为：

```ts
  async refreshSchedules(projectId, client, agentId) {
    try {
      const schedules = await client.listSchedules(agentId);
      set((state) => updateScheduleProject(state, projectId, (data) => ({
        ...data,
        schedulesByAgent: { ...data.schedulesByAgent, [agentId]: schedules },
      })));
      useProjectDataStore.getState().setHasEnabledSchedules(
        projectId,
        agentId,
        schedules.some((s) => s.enabled),
      );
    } catch {
      // silent — schedule refresh failures are non-critical
    }
  },
```

注意：`setHasEnabledSchedules` 调用放在 try 块内、`set` 之后。失败时（catch 分支）不写 project-data-store，保证不会出现「实际拉取失败但 icon 显示已开」的假阳性（与 spec §6 边界处理一致）。

**WS 路径自动覆盖（无需额外任务）：** spec §2.5 提到「WS 作为防御性次要路径」。现有 `handleScheduleEvent`（store.ts:137, 149）在 `schedule_updated` 和 `schedule_completed/failed` 事件里都已调用 `refreshSchedules`。本 Task 把同步逻辑注入 `refreshSchedules` 之后，这两条 WS 路径天然连带更新 `project-data-store`，无需再改 `handleScheduleEvent`。运行态事件（`schedule_triggered`）与 icon 无关，不影响。

`schedule_updated` 是唯一由 `Scheduler.update`（编辑/启停）emit 的事件——本 feature 的关键实时场景「在 dialog 里 toggle enabled」就走这条路径，会被 WS 兜底刷新一次（即便没有 CRUD chokepoint 也会生效，chokepoint 是主保险）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test --workspace=packages/app -- agent-schedule/store.test.ts`
Expected: PASS，全部 7 条用例通过。

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/features/agent-schedule/store.ts packages/app/src/features/agent-schedule/store.test.ts
git commit -m "feat: sync hasEnabledSchedules from useScheduleStore to project-data-store"
```

---

## Task 3: ProjectScope 预载所有 agent 的 schedules

**Files:**
- Modify: `packages/app/src/layouts/ProjectScope.tsx`

**Goal:** 项目首次打开时（且无缓存时），在 `refreshAgents` 之后并发拉取每个 agent 的 schedules，把派生布尔填入 `project-data-store`，让 `AgentRow` 在用户首次看到列表时就有正确的 icon。复用现有 `client.listSchedules` per-agent 接口，零后端改动。

注意：这步不动 `useScheduleStore`（它懒加载、专供 dialog）。预载只写 `project-data-store` 的派生布尔，不污染 feature-local store。

- [ ] **Step 1: 修改 ProjectScope 的 refresh effect**

在 `packages/app/src/layouts/ProjectScope.tsx` 第 52-59 行的 effect 里，把 then 回调扩展为先 refresh sessions，再预载 schedules。

把：

```ts
  useEffect(() => {
    if (!projectId || !client) return;
    const cached = useProjectDataStore.getState().projects[projectId];
    if (cached?.agents?.length) return;
    void refreshAgents(projectId, client).then(() => {
      void refreshSessions(projectId, client);
    });
  }, [client, projectId, refreshAgents, refreshSessions]);
```

改为：

```ts
  useEffect(() => {
    if (!projectId || !client) return;
    const cached = useProjectDataStore.getState().projects[projectId];
    if (cached?.agents?.length) return;
    void refreshAgents(projectId, client).then(() => {
      void refreshSessions(projectId, client);
      void preloadHasEnabledSchedules(projectId, client);
    });
  }, [client, projectId, refreshAgents, refreshSessions]);
```

- [ ] **Step 2: 在文件顶部加 preloadHasEnabledSchedules helper**

在 `ProjectScope.tsx` 顶部、`import` 之后、`export function ProjectScope()` 之前，新增一个模块级 helper：

```ts
async function preloadHasEnabledSchedules(projectId: string, client: import("../lib/api").ApiClient) {
  const agents = useProjectDataStore.getState().projects[projectId]?.agents ?? [];
  const results = await Promise.allSettled(
    agents.map((agent) => client.listSchedules(agent.id)),
  );
  for (let i = 0; i < agents.length; i++) {
    const result = results[i];
    const agentId = agents[i].id;
    if (result.status === "fulfilled") {
      useProjectDataStore
        .getState()
        .setHasEnabledSchedules(projectId, agentId, result.value.some((s) => s.enabled));
    } else {
      console.warn(`preload schedules failed for agent ${agentId}`, result.reason);
    }
  }
}
```

注意：
- 用 `Promise.allSettled` 保证单个失败不阻塞其它（spec §6）。
- `import("../lib/api").ApiClient` 用内联类型引用，避免在顶部再加一行 import（与文件现有风格保持）—— 实施时如果项目 lint 偏好显式 import，就改成顶部 `import type { ApiClient }` 并把签名改成 `client: ApiClient`，二选一保持一致即可。
- 不写入 `useScheduleStore`——dialog 打开时仍会自己 `refreshSchedules`。

- [ ] **Step 3: 类型检查 + lint**

Run: `npm run lint --workspace=packages/app`
Expected: PASS，无错误。

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/layouts/ProjectScope.tsx
git commit -m "feat: preload hasEnabledSchedules in ProjectScope on project open"
```

---

## Task 4: i18n — 新增 `agent-schedule.indicatorTooltip`

**Files:**
- Modify: `packages/i18n/src/locales/zh-CN.ts`
- Modify: `packages/i18n/src/locales/zh-TW.ts`
- Modify: `packages/i18n/src/locales/en.ts`

**Goal:** 加一条 tooltip 文案，三个 locale 必须同时加（`check-i18n.mjs` 会校验 key 一致性，少加会报错）。

- [ ] **Step 1: 在 zh-CN.ts 加基准条目**

在 `packages/i18n/src/locales/zh-CN.ts` 第 195 行（`agent-schedule.logLimitNotice`）之后、空行之前，追加：

```ts
  // agent 列表项上的 Clock icon tooltip：该 agent 至少有一条 enabled schedule，hover icon 时显示
  "agent-schedule.indicatorTooltip": "已开启定时消息",
```

- [ ] **Step 2: 在 zh-TW.ts 加对应条目**

在 `packages/i18n/src/locales/zh-TW.ts` 第 95 行（`agent-schedule.logLimitNotice`）之后追加：

```ts
  "agent-schedule.indicatorTooltip": "已開啟定時訊息",
```

- [ ] **Step 3: 在 en.ts 加对应条目**

在 `packages/i18n/src/locales/en.ts` 第 95 行（`agent-schedule.logLimitNotice`）之后追加：

```ts
  "agent-schedule.indicatorTooltip": "Scheduled messages enabled",
```

- [ ] **Step 4: 跑 i18n 一致性检查**

Run: `npm run check:i18n --workspace=packages/i18n`
Expected: PASS，三个 locale 的 key 集合一致。

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src/locales/zh-CN.ts packages/i18n/src/locales/zh-TW.ts packages/i18n/src/locales/en.ts
git commit -m "feat(i18n): add agent-schedule.indicatorTooltip for schedule icon"
```

---

## Task 5: AgentRow 渲染 Clock icon

**Files:**
- Modify: `packages/app/src/features/agent-session-list/AgentRow.tsx`
- Modify: `packages/app/src/features/agent-session-list/AgentRow.structure.test.ts`

**Goal:** 当 `hasEnabledSchedulesByAgent[agent.id]` 为 true 时，在 agent 名字右侧、hover 菜单左侧，渲染一个常驻 `Clock` icon（非 hover 触发），带原生 `title` tooltip + `aria-label`。复用 `SessionRow` 流式 spinner 的 `ml-auto h-3 w-3 shrink-0 text-muted-foreground` 模式。

- [ ] **Step 1: 写失败结构测试**

在 `packages/app/src/features/agent-session-list/AgentRow.structure.test.ts` 末尾（闭合 `});` 之前）追加：

```ts
  it("renders a persistent Clock icon for agents with enabled schedules", () => {
    const source = readFileSync(join(currentDir, "AgentRow.tsx"), "utf8");

    expect(source).toContain("Clock");
    expect(source).toContain("lucide-react");
    expect(source).toContain('t("agent-schedule.indicatorTooltip")');
    expect(source).toContain("ml-auto h-3 w-3 shrink-0 text-muted-foreground");
    expect(source).toContain("useProjectCtx");
    expect(source).toContain("hasEnabledSchedulesByAgent");
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --workspace=packages/app -- AgentRow.structure.test.ts`
Expected: FAIL — 新 it 中所有 `toContain` 断言失败（AgentRow 还没改）。

- [ ] **Step 3: 改 AgentRow**

把 `packages/app/src/features/agent-session-list/AgentRow.tsx` 整体替换为：

```tsx
import type { AgentProfile } from "../../lib/types";
import { Button } from "../../components/ui/button";
import { CollapsibleTrigger } from "../../components/ui/collapsible";
import { TreeRow } from "../../components/ui/tree-row";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { ChevronRightIcon, Clock, MoreHorizontalIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { cn } from "@/lib/utils";
import { useProjectCtx } from "../../lib/project-context";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useAgentSessionActions } from "./actions-context";

interface AgentRowProps {
  agent: AgentProfile;
  active?: boolean;
}

export function AgentRow({ agent, active }: AgentRowProps) {
  const { t } = useI18n();
  const actions = useAgentSessionActions();
  const { projectId } = useProjectCtx();
  const hasEnabled = useProjectDataStore(
    (s) => s.projects[projectId]?.hasEnabledSchedulesByAgent?.[agent.id] ?? false,
  );
  return (
    <div className="group/agent-row relative">
      <CollapsibleTrigger render={<TreeRow depth={0} className={cn("group pr-8", active && "bg-sidebar-accent")} />}>
        <ChevronRightIcon
          className="size-4 shrink-0 text-sidebar-foreground/70 transition-transform group-data-[panel-open]:rotate-90"
        />
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">
          {agent.name}
        </span>
        {hasEnabled && (
          <Clock
            className="ml-auto h-3 w-3 shrink-0 text-muted-foreground"
            title={t("agent-schedule.indicatorTooltip")}
            aria-label={t("agent-schedule.indicatorTooltip")}
          />
        )}
      </CollapsibleTrigger>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 size-6 opacity-0 group-hover/agent-row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
            />
          }
        >
          <MoreHorizontalIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => actions.newSession(agent)}>
            {t("agent-session-list.newSession")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.editAgent(agent)}>
            {t("common.edit")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.scheduleAgent(agent)}>
            {t("agent-schedule.menuItem")}
            <DropdownMenuShortcut>Beta</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => actions.deleteAgent(agent)}>
            {t("common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

改动点说明：
- 加 `Clock` 到 lucide-react import。
- 加 `useProjectCtx` import（拿 projectId，遵循 spec「URL/Context 是真相源」约定，不是从 props 透传）。
- 加 `useProjectDataStore` 订阅派生布尔。
- 在 name span 之后、DropdownMenu 之前条件渲染 `Clock`。`Clock` 用 `ml-auto` 推到右侧（与 `SessionRow` spinner 一致），位于 `MoreHorizontalIcon`（`absolute right-1`）左侧，不冲突。
- `title` + `aria-label` 用同一 i18n key（spec §3.3）。

- [ ] **Step 4: 跑结构测试确认通过**

Run: `npm test --workspace=packages/app -- AgentRow.structure.test.ts`
Expected: PASS，原 it + 新 it 全部通过。

- [ ] **Step 5: 跑 agent-session-list 全部测试确保没回归**

Run: `npm test --workspace=packages/app -- agent-session-list`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/features/agent-session-list/AgentRow.tsx packages/app/src/features/agent-session-list/AgentRow.structure.test.ts
git commit -m "feat: render Clock icon on AgentRow for agents with enabled schedules"
```

---

## Task 6: 验证

**Files:** 无（仅运行检查）

- [ ] **Step 1: i18n 一致性**

Run: `npm run check:i18n --workspace=packages/i18n`
Expected: PASS。

- [ ] **Step 2: 单元测试 — app**

Run: `npm test --workspace=packages/app`
Expected: 全部 PASS。

- [ ] **Step 3: lint**

Run: `npm run lint --workspace=packages/app`
Expected: PASS。

- [ ] **Step 4: 类型 + build**

Run: `npm run build --workspace=packages/app`
Expected: PASS。

- [ ] **Step 5: 全仓库 verify（可选，最稳）**

Run: `npm run verify`
Expected: PASS（lint + build + unit tests + i18n check 全绿）。

> 完成 Task 6 后不需要再 commit（无文件改动）。

---

## 手动验证清单（实施后建议跑一遍）

1. 打开一个有多个 agent 的项目，其中一个 agent 已配置 enabled schedule、一个未配置、一个配置了但全部 disabled → 只有第一个 agent 行显示 Clock icon。
2. 在 dialog 里把第一个 agent 的 schedule 改为 disabled → icon 消失（无需手动刷新，CRUD chokepoint 生效）。
3. 给第二个 agent 新建一个 enabled schedule → icon 出现。
4. 删除该 schedule → icon 消失。
5. 关闭项目再重新打开 → icon 状态与配置一致（preload 生效）。
6. hover icon → tooltip 文案正确。
7. 切换 locale（中/英）→ tooltip 文案随之切换。
8. 点击 icon → 行为同点击该行其余非按钮区域（展开/折叠 session 列表）。
