# Bugfix: Settings 切换模型不生效

## 问题描述

在 Settings 界面切换默认模型后，新建会话仍然使用旧模型（或项目创建时的默认模型 `gemini-2.5-pro`），模型切换未生效。

## 数据流追踪

模型切换的完整数据流：

```
[UI] <select> 下拉框 onChange
  → store.setDefaultModel("provider/modelId")    // zustand store 更新

[UI] 点击"保存"按钮
  → store.save(electronAPI)
  → electronAPI.saveSettings(settings)            // IPC → main process
  → saveSettings(settings)                        // 持久化到 electron-store
  → updateDefaultModel(settings.defaultModel)     // 遍历所有 server
    → engine.setDefaultModel("provider/modelId")  // 更新 engine.globalDefaultModel

[Engine] 新建会话时 buildAgent()
  → modelId = profile.model ?? globalDefaultModel ?? config.defaultModel
  → resolveModelById(modelId)
```

## 根因分析

### Bug 1: 断开连接时 defaultModel 清除逻辑错误

**位置**: `packages/app/src/features/settings/store.ts:94-96`

```typescript
const nextDefaultModel =
  defaultModel && providers[id]?.models.some((m) => m.id === defaultModel)
    ? ""
    : defaultModel;
```

`m.id` 是 bare model ID（如 `deepseek-v4-flash`），但 `defaultModel` 是 `"provider/modelId"` 格式（如 `"deepseek/deepseek-v4-flash"`）。比较永远不匹配，导致：

- 断开 provider 后 defaultModel 不会被清除
- 之后创建会话时会尝试使用已断开 provider 的模型，导致 API 调用失败（无 API key）

**影响**: 间接导致模型切换混乱。用户断开旧 provider、连接新 provider 后，defaultModel 仍指向已断开的 provider 模型。

### Bug 2: save 保存后未确保 engine 已更新

**位置**: `packages/app/electron/ipc/settings.ts:12-16`

```typescript
ipcMain.handle("save-settings", (_event, settings: AppSettings) => {
  saveSettings(settings);
  updateDefaultModel(settings.defaultModel || undefined);
  return { success: true };
});
```

`updateDefaultModel` 是同步函数，遍历 `servers` Map 更新所有 engine。逻辑本身正确，但存在以下问题：

- 如果用户先"连接" provider（触发 `connect → save`），此时 `defaultModel` 为空字符串，`"" || undefined` 计算为 `undefined`，会清除所有 engine 的 `globalDefaultModel`。用户之后再选择模型并"保存"，`updateDefaultModel` 才会设置新值。这个流程本身正确，但如果用户只"连接"而没有再次"保存"就创建会话，则 `globalDefaultModel` 为 `undefined`，会 fallback 到 `config.defaultModel`（项目创建时的 `"gemini-2.5-pro"`）。

### Bug 3: connect 操作与模型选择解耦导致中间状态

**位置**: `packages/app/src/features/settings/store.ts:85-88`

```typescript
async connect(api, id) {
  if (!get().apiKeys[id]?.trim()) return false;
  return get().save(api);
},
```

"连接"按钮直接调用 `save()`，此时如果用户还没选择 defaultModel（值为 `""`），保存会将 `globalDefaultModel` 设为 `undefined`。用户体验上，他们可能：

1. 输入 API Key → 点击"连接" → 此时 defaultModel 为空，engine 的 globalDefaultModel 被清除
2. 选择模型 → 下拉框 onChange 更新 store
3. 忘记点击"保存" → 直接去新建会话 → model 使用 config.defaultModel

这不是代码 bug，而是 UX 问题：模型选择后没有自动保存，用户需要额外点击"保存"。

## 方案

### Fix 1: 修复 disconnect 时的模型比较逻辑

将 `m.id === defaultModel` 改为 `defaultModel.startsWith(id + "/")` 来匹配 provider-prefixed 格式。

```typescript
// store.ts disconnect 方法中
const nextDefaultModel =
  defaultModel && providers[id]?.models.some((m) => defaultModel === `${id}/${m.id}`)
    ? ""
    : defaultModel;
```

### Fix 2: connect 操作不清除 globalDefaultModel

将 `ipc/settings.ts` 中的 `updateDefaultModel` 调用改为：只在 `defaultModel` 非空时更新 engine。

```typescript
ipcMain.handle("save-settings", (_event, settings: AppSettings) => {
  saveSettings(settings);
  if (settings.defaultModel) {
    updateDefaultModel(settings.defaultModel);
  }
  return { success: true };
});
```

同时在 `server.ts` 的 `updateDefaultModel` 中也保持一致：

```typescript
export function updateDefaultModel(defaultModel: string | undefined): void {
  for (const [, entry] of servers) {
    entry.engine.setDefaultModel(defaultModel);
  }
}
```

去掉 `defaultModel || undefined` 的冗余转换。

### Fix 3: 模型选择变更后自动标记需保存

不自动保存（避免频繁 IPC 调用），但确保用户切换模型后"保存"按钮足够醒目，或在模型变更后自动触发保存。

选择**最简方案**：在 `DefaultModelField` 的 `onChange` 中，选择模型后立即调用 `save`。

```typescript
<NativeSelect
  className="w-full"
  value={value}
  onChange={(e) => {
    onChange(e.target.value);
    // 立即保存，确保模型变更生效
    save(electronAPI);
  }}
>
```

这样用户切换模型后无需额外点击"保存"，模型变更立即持久化并通知 engine。

## 改动清单

| 文件 | 改动 |
|------|------|
| `packages/app/src/features/settings/store.ts` | 修复 disconnect 中模型比较逻辑 |
| `packages/app/electron/ipc/settings.ts` | defaultModel 为空时不调用 updateDefaultModel |
| `packages/app/electron/server.ts` | 去掉 updateDefaultModel 中冗余的 `\|\| undefined` |
| `packages/app/src/features/settings/index.tsx` | DefaultModelField onChange 中自动触发保存 |

## 测试

在 `packages/app/src/features/settings/` 下更新或新增测试：

- **disconnect 清除模型验证**: 配置 `defaultModel = "deepseek/deepseek-v4-flash"`，断开 deepseek provider 后验证 defaultModel 被清除为 `""`
- **disconnect 保留其他 provider 模型验证**: 配置 `defaultModel = "openai/gpt-4o"`，断开 deepseek provider 后验证 defaultModel 不变
- **connect 不清除已有模型验证**: 已设置 defaultModel 后，连接新 provider 验证 defaultModel 不被清除
