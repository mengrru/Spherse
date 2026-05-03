# Backlog

## 代码质量

- [ ] **恢复 React StrictMode 并修复 WebSocket effect cleanup**：`src/main.tsx` 当前移除了 StrictMode 以避免开发模式下双重 mount 导致 WebSocket 错误事件。正确做法是保留 StrictMode，在 `ChatPage` 的 `useEffect` 中用 ref 追踪活跃的 WebSocket 实例，忽略已关闭 socket 的事件。涉及文件：`packages/app/src/pages/ChatPage.tsx`、`packages/app/src/main.tsx`。

## 功能增强

- [ ] **Agent 编辑**：支持编辑已有 agent 定义文件（当前只能创建）
- [ ] **Agent 删除**：从 UI 删除 agent 定义文件
- [ ] **Session 历史**：在侧边栏显示历史 session 列表，支持恢复对话
- [ ] **多 Session**：同一 agent 开启多个对话
- [ ] **项目创建向导**：HomePage 区分"新建项目"和"打开项目"，支持设置项目名和默认模型

## 基础设施

- [ ] **electron-builder 打包**：配置生产构建和跨平台打包
- [ ] **better-sqlite3 rebuild 自动化**：在 postinstall 中自动为 Electron 重新编译 native 模块
- [ ] **E2E 测试**：Playwright 或 Spectron 端到端测试
