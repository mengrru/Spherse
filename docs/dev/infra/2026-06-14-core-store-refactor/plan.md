# Core Store 层树状重构 — Implementation Plan

**Design doc:** `docs/dev/infra/2026-06-14-core-store-refactor/design.md`

---

### Task 1: ProjectConfigStore

**Files:**
- Create: `packages/core/src/store/project-config.ts`

- [ ] 从现有 `project.ts` 提取 yaml 读写逻辑，创建 `ProjectConfigStore`

把 `project.ts` 中所有 project.yaml 相关的逻辑收敛到 `ProjectConfigStore`：
- `read()` / `write()` 替代散落的 `fs.readFile/writeFile + YAML.parse/stringify`
- `get()` 返回内存缓存
- `getProjectId()` / `regenerateProjectId()`
- `getAiAccessSettings` / `updateAiAccessSettings`
- `getWelcomePageSettings` / `updateWelcomePageSettings`

- [ ] 编译验证

```bash
npm run build --workspace=packages/core
```

---

### Task 2: 重构 SessionStore 为 per-agent

**Files:**
- Modify: `packages/core/src/store/session.ts`

- [ ] 构造函数从 `(agentsDir, logger)` 改为 `(dbPath, logger)`
- [ ] 去掉 `connections: Map<agentId, Database>`，改为单个 `db: Database.Database`
- [ ] 去掉 `findAgentDir()` / `getDb(agentId)` / `closeAgent(agentId)` / `dirCache`
- [ ] 所有方法去掉 `agentId` 参数
- [ ] `applyMigrations` 不变
- [ ] `close()` 关闭单个 db

---

### Task 3: 重构 ScheduleStore 为 per-agent

**Files:**
- Modify: `packages/core/src/store/schedule.ts`

- [ ] 删除模块级 `findAgentDir()` 函数
- [ ] 删除 `resolveAgentDir()` 方法
- [ ] 构造函数从 `(agentsDir, logger)` 改为 `(agentDir, logger)`
- [ ] 所有方法去掉 `agentId` 参数
- [ ] 文件路径在构造时确定

---

### Task 4: 重构 AgentProfileStore 为 per-agent

**Files:**
- Modify: `packages/core/src/store/agent-profile.ts`

- [ ] 构造函数从 `(agentDir)` 改为 `(profilePath, slug)`
- [ ] 删除 `list()` / `getById()` / `getByName()` / `delete()`（上移到 ProjectStore）
- [ ] `read()` 读单个 profile.md
- [ ] `save()` 只更新已存在的 profile.md，去掉 slug 碰撞检测逻辑
- [ ] `getTheme()` / `saveTheme()` / `getRawContent()` 路径从 profile.filePath 推导

---

### Task 5: 新建 AgentStore

**Files:**
- Create: `packages/core/src/store/agent-store.ts`

- [ ] 创建 `AgentStore` 类，聚合 profile + sessions + schedules
- [ ] `open()` 读 profile.md，初始化三个子 store
- [ ] getter: `profile` / `sessions` / `schedules`
- [ ] `getProfile()` / `getAgentDir()` / `close()`

---

### Task 6: 重构 ProjectStore 为聚合根

**Files:**
- Modify: `packages/core/src/store/project.ts`

- [ ] 持有 `configStore` / `skillStore` / `agents: Map<string, AgentStore>`
- [ ] `open()` 打开 config + 扫描 agents 目录创建 AgentStore
- [ ] `create()` 新建项目 + 调用 presets
- [ ] getter: `config` / `skill` / `agents`（未 open 抛异常）
- [ ] `listAgents()` 遍历 agents Map 返回 profiles
- [ ] `getAgent(agentId)` O(1) 查找
- [ ] `createAgent(slug, content, themeContent?)` — TODO 碰撞检测
- [ ] `deleteAgent(agentId)` — 删目录 + Map 移除
- [ ] 保留 `readIndex` / `updateIndex` / `appendChangelog` / `getRootPath` / `close`
- [ ] 删除所有 config/skill 的 delegate 方法

---

### Task 7: 适配 factory / presets / scheduler / index

**Files:**
- Modify: `packages/core/src/factory.ts`
- Modify: `packages/core/src/presets.ts`
- Modify: `packages/core/src/scheduler.ts`
- Modify: `packages/core/src/store/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] `factory.ts`: `createEngine` 用 `new ProjectStore(root)` + `.open()`，简化路径拼接
- [ ] `presets.ts`: `initPresets` 参数从 `AgentProfileStore` 改为 `ProjectStore`，用 `projectStore.createAgent(slug, content)`
- [ ] `scheduler.ts`: 构造函数改为 `(engine, projectStore)`，持久化通过 `projectStore.getAgent(agentId).schedules`，`loadFromProfiles` 遍历 `projectStore.agents`
- [ ] 更新 `store/index.ts` 导出（新增 `AgentStore`、`ProjectConfigStore`）
- [ ] 更新 `core/src/index.ts` 导出

- [ ] 编译验证

```bash
npm run build --workspace=packages/core
```

---

### Task 8: 更新测试

**Files:**
- Modify: `packages/core/src/__tests__/store/*.test.ts`
- Modify: `packages/core/src/__tests__/engine.test.ts`
- Modify: `packages/core/src/__tests__/scheduler.test.ts`
- Create: `packages/core/src/__tests__/store/project-config.test.ts`
- Create: `packages/core/src/__tests__/store/agent-store.test.ts`

- [ ] 新建 `project-config.test.ts`
- [ ] 重写 `project.test.ts` — 测 agent 管理
- [ ] 新建 `agent-store.test.ts`
- [ ] 精简 `agent-profile.test.ts` — 去掉 list/getById 测试
- [ ] 精简 `session.test.ts` — 去掉 agentId 参数
- [ ] 精简 `schedule.test.ts` — 去掉 agentId 参数
- [ ] 适配 `engine.test.ts` — 新 store 签名
- [ ] 适配 `scheduler.test.ts` — 构造函数签名

- [ ] 运行测试

```bash
npm test --workspace=packages/core
```

---

### Task 9: 全量验证 + commit

- [ ] 编译全部 package

```bash
npm run build
```

- [ ] lint

```bash
npm run lint
```

- [ ] core 测试

```bash
npm test --workspace=packages/core
```

- [ ] Commit（包含 design.md + plan.md + 实现）
