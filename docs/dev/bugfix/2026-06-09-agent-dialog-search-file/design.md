# [Bugfix] Agent Dialog 搜索文件功能失效 & 组件拆分

## 问题描述

Agent dialog 中「添加参考资料」的搜索文件输入框无法触发搜索建议。输入任何内容后，下拉建议列表始终为空。

## 根因分析

**位置**: `packages/app/src/lib/api.ts:225`

```typescript
async getFileTree(): Promise<string[]> {
  const res = await fetch(`${baseUrl}/api/file-tree`);
  if (!res.ok) return [];
  return parseJsonResponse(res, schemas.aiAccessSettingsResponse); // BUG
}
```

`GET /api/file-tree` 返回 `string[]`（文件路径列表），但 `getFileTree()` 使用 `schemas.aiAccessSettingsResponse` 解析响应。该 schema 期望 `{ ok: boolean, deniedPaths: string[] }`，与实际 `string[]` 不匹配，导致 `parseApiResponse` 抛出校验错误。

左侧文件树不受影响，因为它使用的是不同的 API：`client.listContent()` → `GET /api/content/{dirPath}`（按目录层级加载 `FileEntry[]`），使用正确的 `schemas.fileEntries` 校验，不会触发此 bug。只有 agent dialog 的搜索文件功能用的是 `getFileTree()` → `GET /api/file-tree`（一次性加载全量平铺文件列表）。

`ContextPathField` 的 `useEffect`（`AgentDialog.tsx:205-209`）中 `.catch(() => {})` 静默吞掉了该错误，`fileTree` 保持为空数组，`matchFiles()` 永远找不到匹配项，下拉建议列表始终为空。

完整调用链：

```
ContextPathField mount → client.getFileTree()
  → fetch GET /api/file-tree → 返回 string[]
  → parseJsonResponse(res, schemas.aiAccessSettingsResponse)
  → parseApiResponse 校验失败，抛出 Invalid payload
  → .catch(() => {}) 吞掉错误
  → fileTree = [] → matchFiles() 无匹配 → 下拉列表为空
```

## 修复方案

### 改动 1：添加 file tree response schema

文件：`packages/server/src/contracts/index.ts`

新增 `fileTreeResponse` schema：

```typescript
fileTreeResponse: Type.Array(Type.String()),
```

并导出对应类型：

```typescript
export type FileTreeResponse = Static<typeof schemas.fileTreeResponse>;
```

### 改动 2：修复 API client schema 引用

文件：`packages/app/src/lib/api.ts:225`

将 `schemas.aiAccessSettingsResponse` 替换为 `schemas.fileTreeResponse`：

```typescript
async getFileTree(): Promise<string[]> {
  const res = await fetch(`${baseUrl}/api/file-tree`);
  if (!res.ok) return [];
  return parseJsonResponse(res, schemas.fileTreeResponse);
}
```

### 改动 3：拆分 SearchFileField 通用组件

文件：新建 `packages/app/src/components/SearchFileField.tsx`

将 `AgentDialog.tsx` 中 `ContextPathField` 的**搜索输入 + 建议下拉**部分提取为通用组件 `SearchFileField`，职责为：加载项目文件树、根据输入做模糊匹配、展示建议下拉列表。选中建议项时通过回调通知调用方。

组件接口：

```typescript
interface SearchFileFieldProps {
  client: ApiClient;
  exclude?: string[];
  onSelect: (path: string) => void;
  placeholder?: string;
}
```

- `exclude`：已选路径列表，从建议中排除（如 agent dialog 传入已添加的 context paths）
- `onSelect`：用户点击建议项或按下 Enter（输入框有值时）触发的回调，行为由调用方决定
- 组件内部管理：fileTree 加载、搜索输入、debounce、建议列表、下拉显隐
- 不负责已选路径的展示（Badge）和删除，这些由调用方处理

`AgentDialog.tsx` 中的 `ContextPathField` 保留为简单包装：渲染 `SearchFileField` + 已选路径 Badge 列表 + 删除按钮。`AgentDialog.tsx` 改为导入 `SearchFileField`：

```typescript
import { SearchFileField } from "./SearchFileField";
```

拆分后 `SearchFileField.tsx` 约 90 行，`AgentDialog.tsx` 中 `ContextPathField` 简化为约 50 行（Badge 展示 + SearchFileField 组合），`AgentDialog.tsx` 总计约 210 行。

### 改动 4：添加 E2E 测试

文件：新建 `packages/app/e2e/agent-dialog.spec.ts`

测试用例：

1. **搜索建议正常显示**：创建包含若干文件的项目，打开 agent 创建 dialog，在参考资料输入框中输入文件名关键字，验证下拉建议列表中出现匹配文件路径
2. **点击建议项添加路径**：从建议列表点击一个文件，验证该路径以 Badge 形式显示在输入框上方，且建议列表关闭
3. **Enter 键手动输入路径**：输入一个不在建议中的路径并按 Enter，验证路径被添加

E2E 测试复用 `e2e/helpers/electron.ts` 中的 `launchAppWithProject` 模式，创建包含文件的测试项目，通过 sidebar 的 `+` 按钮打开 agent dialog。

## 影响范围

- `packages/server/src/contracts/index.ts` — 新增 schema
- `packages/app/src/lib/api.ts` — 修复 schema 引用
- `packages/app/src/components/SearchFileField.tsx` — 新文件，通用搜索文件组件
- `packages/app/src/components/AgentDialog.tsx` — 删除搜索相关内部逻辑，改为使用 SearchFileField；ContextPathField 保留为 Badge 展示 + SearchFileField 包装
- `packages/app/e2e/agent-dialog.spec.ts` — 新增 E2E 测试
- 不影响 agent dialog 的其他功能（名称输入、工具选择、system prompt、theme tab）
- 不影响 agent 创建/编辑的提交逻辑
- 不影响 server 端 file-tree route 的行为

## 验证方式

1. 打开 agent 创建 dialog，在参考资料输入框输入项目中的文件名，确认下拉建议列表显示匹配文件
2. 点击建议项确认路径正确添加为 Badge
3. 按 Enter 手动输入路径确认可用
4. 确认删除已添加路径的功能正常
5. 运行 E2E 测试 `npm run test:e2e --workspace=packages/app -- e2e/agent-dialog.spec.ts` 通过
6. 运行 `npm run lint` 通过
