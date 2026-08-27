# 项目打开失败覆盖项目文件问题分析与修复

## 现象

打开一个已有项目时，如果 `open()` 阶段出现任何异常（`.spherse/project.yaml` 手动写坏、文件为空、IO 权限错误等），项目会被**静默当作新项目重建**：

- `.spherse/project.yaml` 被无条件重写（新 `nanoid(8)` id + 目录名 + 当前时间），丢失 `aiAccess.deniedPaths`（AI 访问安全配置）、`welcomePage`、原 name/created 等全部原有配置
- 根目录 `AGENTS.md` 被模板 `AGENTS_INDEX_TEMPLATE` 覆盖，用户项目索引内容全部丢失
- 根目录 `CHANGELOG.md` 被截断为空字符串，变更历史全部丢失

且整个覆盖过程对外表现为"打开成功"：desktop 的 `restore-projects`（ipc/project.ts）与 `ensureServer`（server.ts）对注册失败静默吞错，用户完全无感知。

## 根因

`packages/core/src/factory.ts` 的 `assembleProject`：

```ts
try {
  await projectStore.open();
} catch {
  isNewProject = true;
  await projectStore.create(dirName);  // 直接重建/覆盖
}
```

不区分错误类型，把 `open()` 的一切失败都当作"新项目"信号。而 `open()` 实际会因以下全部原因抛错：

1. `project.yaml` 不存在——唯一合法的"新项目"信号
2. `project.yaml` YAML 语法损坏（`YAML.parse` 抛 `YAMLParseError`）
3. `project.yaml` 为空文件（`YAML.parse("")` 返回 `null`，取 `.id` 抛 TypeError）
4. 读文件 IO/权限错误（EACCES 等）

另外 `ProjectStore.create()` 写根目录 `AGENTS.md` / `CHANGELOG.md` 时不检查文件是否已存在，直接 `fs.writeFile` 覆盖——即在已有 repo（自带 `AGENTS.md`）上初始化新项目也会覆盖用户文件。

## 修复方案

1. **精确的"新项目"信号**：`packages/core/src/errors.ts` 新增 `ProjectConfigNotFoundError`（文件缺失）与 `ProjectConfigParseError`（YAML 损坏/空文件/非对象含数组）。`ProjectConfigStore.read()` 按失败原因抛专用错误，不再混入通用异常通道。
2. **fail-safe 的 factory**：`assembleProject` 的 catch 只放行 `ProjectConfigNotFoundError` 走 `create()`，其余错误（损坏、IO）直接上抛——打开失败宁可失败，不可覆盖。
3. **create() 不覆盖用户文件**：根目录 `AGENTS.md` / `CHANGELOG.md` 改用 `wx` flag 写入（`writeFileIfMissing` helper），已存在则保留。`.spherse/project.yaml` 由 factory 的 ENOENT 前置保证不覆盖。
4. **失败可见**：desktop 两处静默 catch（`ipc/project.ts` restore-projects、`server.ts` ensureServer）改为 `console.error` 记录；renderer 侧 activity-bar 的"添加项目"入口补 try/catch + toast（`activity-bar.openProjectFailed`），损坏项目打开失败不再静默无反应。

## 影响面

- core：`errors.ts`、`store/project-config.ts`、`store/project.ts`、`factory.ts`
- app：`features/activity-bar/use-project-actions.ts`
- desktop：`electron/ipc/project.ts`、`electron/server.ts`（仅日志）
- i18n：三语言新增 `activity-bar.openProjectFailed`

## 行为变更说明

修复后，损坏的项目（yaml 坏/空/IO 错）打开会失败并被 restore 流程跳过（带日志），不再被重建为空项目。这是刻意设计：配置文件损坏应让用户察觉并修复，而不是以丢失全部项目配置为代价"假装打开成功"。
