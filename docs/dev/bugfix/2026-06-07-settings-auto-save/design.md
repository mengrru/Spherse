# [Bugfix] Settings 配置自动保存，移除底部 footer

## 问题描述

1. Settings 弹窗底部有 "Close" 和 "Save" 按钮，用户修改 locale 等配置后需要手动点击 Save 才能保存。部分字段（Default Model、Connect/Disconnect）已有即时保存逻辑，但 locale 变更不会自动保存。
2. App 启动时 locale 未从 electron-store 加载，始终显示硬编码的 `zh-CN`，直到用户打开 Settings 才切换到保存的语言。

## 根因分析

### 问题 1: locale 不自动保存

**位置**: `packages/app/src/features/settings/index.tsx:92`

locale 的 `onChange` 仅调用 `setLocale(e.target.value)` 更新 Zustand 内存状态，未触发持久化保存。与 Default Model 的 `handleModelChange` 行为不一致。

### 问题 2: 启动时 locale 不正确

**位置**: `packages/app/src/App.tsx`

`useSettingsStore.load()` 是唯一从 electron-store 读取保存 locale 的方法，但**只在 SettingsModal 组件挂载时调用**。Zustand store 的 `locale` 初始值硬编码为 `"zh-CN"`，App 启动阶段从未调用 `load()`。

## 修复方案

### 改动 1: Store 新增 `changeLocale` 方法

文件：`packages/app/src/features/settings/store.ts`

```ts
changeLocale: async (api: SettingsApi, locale: string) => {
  set({ locale });
  return get().save(api);
}
```

### 改动 2: 组件层 locale onChange 改用 `changeLocale`

文件：`packages/app/src/features/settings/index.tsx`

locale selector 切换时自动保存，与 Default Model 行为一致。

### 改动 3: 移除 DialogFooter

文件：`packages/app/src/features/settings/index.tsx`

完全移除 `DialogFooter`（包括状态文字），因为所有字段均自动保存，无需手动保存和状态反馈。用户通过点击弹窗外区域或按 Esc 关闭弹窗。

同步清理：移除 `DialogFooter` import、`message` 引用、`saving` 引用、`onClose` prop 传递。

### 改动 4: App 启动时加载 settings

文件：`packages/app/src/App.tsx`

在 `App` 组件中新增 `useEffect`，启动时调用 `loadSettings(electronAPI)` 从 electron-store 加载保存的 locale，确保首次渲染即使用正确的语言。

## 影响范围

- `packages/app/src/features/settings/store.ts` — 新增 `changeLocale` 方法
- `packages/app/src/features/settings/index.tsx` — locale 自动保存，移除 DialogFooter，清理引用
- `packages/app/src/features/settings/store.test.ts` — 补充 `changeLocale` 测试
- `packages/app/src/App.tsx` — 启动时加载 settings
- 不影响 API Key / Connect / Disconnect 行为
- 不影响 Default Model 行为

## 验证方式

1. App 启动后确认 locale 为上次保存的语言
2. 打开 Settings，切换 locale，确认自动保存
3. 确认 Settings 弹窗无底部 footer
4. 点击弹窗外区域或按 Esc，确认弹窗正常关闭
5. 确认 API Key / Connect / Disconnect / Default Model 行为不变
