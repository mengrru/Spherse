# 持久化"上次访问的 route"

## 背景

应用已有 `lastActiveProject` 机制：通过 `electron-store` 记住最后活跃的项目路径，在下次启动时自动恢复到该项目。但恢复粒度只到项目级别——重启或切换项目后，总是导航到 `/project/:projectKey`（项目空态），丢失了用户上次正在查看的具体子路由（某个 chat session 或 content 页面）。

现有的 `openProjects` 条目存储了 `{ path, name, lastOpened }`，路由子状态尚未纳入持久化。

## 目标

1. 每个项目各自记住最后一次访问的子路由（如 `/chat/abc123`、`/content?path=foo.md`）。
2. 应用启动时，恢复到最后活跃项目并导航到该项目上次访问的子路由。
3. 项目间切换时，导航到目标项目上次访问的子路由。

## 非目标

- 不改变现有路由结构。
- 不持久化组件内部的临态（如输入框草稿、编辑器 dirty 状态、WebSocket 消息流）。
- 不处理子路由中引用的资源已被删除的情况——由现有 UI 逻辑自然处理（session 不存在时显示项目空态，文件不存在时 ContentBrowser 展示错误）。

## 数据模型

### `OpenProjectEntry` 扩展

```ts
export interface OpenProjectEntry {
  path: string;
  name: string;
  lastOpened: string;
  lastRoute?: string; // 新增：相对于 /project/:projectKey 的子路由
}
```

`lastRoute` 的值举例：

| 场景 | URL | lastRoute |
|------|-----|-----------|
| 项目空态 | `/project/foo` | `""` |
| Chat 会话 | `/project/foo/chat/abc123` | `"/chat/abc123"` |
| 内容浏览 | `/project/foo/content?path=bar.md&sessionId=xyz` | `"/content?path=bar.md&sessionId=xyz"` |

### `ProjectState` 扩展

```ts
export interface ProjectState {
  key: string;
  path: string;
  name: string;
  port: number;
  ctx: AppContext;
  lastRoute?: string; // 新增：运行时缓存，restore 时填充
}
```

`lastRoute` 在 `ProjectState` 中充当内存缓存，避免每次切换项目时额外 IPC 读取。

## 各层变更

### 1. Electron main — `packages/app/electron/settings.ts`

- `OpenProjectEntry` 新增 `lastRoute?: string` 字段。
- 新增 `updateProjectLastRoute(projectPath: string, route: string): void`：按 `path` 查找 `openProjects` 条目，更新 `lastRoute`，写入 store。

### 2. IPC — `packages/app/electron/ipc/project.ts`

- 新增 `set-project-last-route` handler，接收 `(projectPath, route)`，调用 `updateProjectLastRoute`。
- `restore-projects` handler：将 `entry.lastRoute` 一并返回，返回类型变为 `Array<{ path, name, port, lastRoute? }>`。

### 3. Preload — `packages/app/electron/preload.ts`

- 暴露 `setProjectLastRoute(projectPath: string, route: string)` IPC 方法。

### 4. 类型声明 — `packages/app/src/main.tsx`

- `Window.electronAPI` 新增 `setProjectLastRoute` 类型。
- `restoreProjects` 返回类型新增 `lastRoute?` 字段。

### 5. App store — `packages/app/src/stores/app-store.ts`

- `restoreProjects()`：将 IPC 返回的 `lastRoute` 写入对应的 `ProjectState`。
- 新增 `setProjectLastRoute(projectKey: string, route: string)` action：
  - 调用 IPC 持久化。
  - 更新 store 中对应 `ProjectState.lastRoute`。

### 6. 路由持久化 — `packages/app/src/layouts/ProjectLayout.tsx`

在 `ProjectLayout` 中新增 `useEffect`，监听 `location` 变化，提取当前子路由并调用 `setProjectLastRoute`：

```ts
useEffect(() => {
  const fullPath = location.pathname + location.search;
  const prefix = `/project/${projectKey}`;
  const subRoute = fullPath.startsWith(prefix)
    ? fullPath.slice(prefix.length)
    : "";
  void setProjectLastRoute(projectKey, subRoute);
}, [location, projectKey, setProjectLastRoute]);
```

此 effect 在每次路由变化后触发，将子路由写入 store 和 electron-store。路由变化频率低（用户点击），无需 debounce。

### 7. 启动恢复 — `packages/app/src/App.tsx`

修改启动 useEffect，恢复时导航到项目 + 子路由：

```ts
restoreProjects().then((projectKey) => {
  if (!cancelled && hashPath === "/" && projectKey) {
    const project = useAppStore.getState().projects.get(projectKey);
    const lastRoute = project?.lastRoute || "";
    navigate(`/project/${projectKey}${lastRoute}`, { replace: true });
  }
});
```

### 8. 项目切换与关闭 — `packages/app/src/App.tsx`

修改 `handleSelectProject`，切换时导航到目标项目上次子路由：

```ts
const handleSelectProject = async (projectKey: string) => {
  await setActiveProject(projectKey);
  const project = useAppStore.getState().projects.get(projectKey);
  const lastRoute = project?.lastRoute || "";
  navigate(`/project/${projectKey}${lastRoute}`);
};
```

修改 `handleCloseProject`，关闭后导航到下一个项目时也恢复子路由：

```ts
const handleCloseProject = async (projectKey: string) => {
  const nextProjectKey = await closeProject(projectKey);
  clearProjectData(projectKey);
  clearProjectUi(projectKey);
  if (nextProjectKey) {
    const project = useAppStore.getState().projects.get(nextProjectKey);
    const lastRoute = project?.lastRoute || "";
    navigate(`/project/${nextProjectKey}${lastRoute}`);
  } else {
    navigate("/");
  }
};
```

## 保存时机汇总

| 触发点 | 保存方式 |
|--------|----------|
| 用户进入 chat session | ProjectLayout effect 检测 pathname 变化，保存 `/chat/:sessionId` |
| 用户打开 content 页 | ProjectLayout effect 检测 pathname + search 变化，保存 `/content?path=...` |
| 用户回到项目空态 | ProjectLayout effect 保存 `""` |
| 用户切换项目 | 不额外保存当前项目；当前项目 lastRoute 已由 ProjectLayout effect 在项目内路由变化时自动保存 |

## 恢复时机汇总

| 触发点 | 恢复方式 |
|--------|----------|
| 应用启动 | App.tsx 读取 restore 后的 `project.lastRoute`，拼接导航 |
| 项目切换 | handleSelectProject 读取 `project.lastRoute`，拼接导航 |
| 项目关闭 | 关闭后导航到下一个项目时，同样恢复该项目的 lastRoute（与项目切换行为一致） |

## 边界情况

1. **lastRoute 引用已删除的 session**：Chat 组件找不到对应 session 时显示项目空态，与现有行为一致。用户下次有效导航会覆盖 lastRoute。
2. **lastRoute 引用已删除的文件**：ContentBrowser 显示文件加载错误，与现有行为一致。
3. **首次使用 / 无 lastRoute**：`lastRoute` 为 `undefined` 或 `""`，导航到 `/project/:key`（项目空态），与现有行为一致。
4. **项目关闭**：关闭项目时 `openProjects` 条目被移除，`lastRoute` 随之清理。
5. **启动时 URL 已指定子路由**：如果用户手动在 URL 输入特定路由（如刷新页面），`hashPath !== "/"` 跳过自动恢复，保留 URL 指定的路由。

## 涉及文件

```text
packages/app/electron/settings.ts          # OpenProjectEntry 扩展 + 新函数
packages/app/electron/ipc/project.ts       # 新 IPC handler + restore 返回 lastRoute
packages/app/electron/preload.ts           # 暴露新 IPC
packages/app/src/main.tsx                  # 类型声明更新
packages/app/src/stores/app-store.ts       # ProjectState 扩展 + 新 action
packages/app/src/layouts/ProjectLayout.tsx # 新增路由持久化 effect
packages/app/src/App.tsx                   # 启动恢复 + 项目切换恢复 + 关闭恢复
```

## 测试与验证

- `npm run build --workspace=packages/app` 编译通过。
- 手动验证：打开项目 A 的 chat session，切换到项目 B，切回 A 时应恢复到该 session。
- 手动验证：打开项目 A 的 content 页面，关闭应用，重新打开后应恢复到该 content 页面。
- 手动验证：首次打开项目（无 lastRoute）应显示项目空态。
- 手动验证：项目间来回切换，各项目独立记忆子路由。
