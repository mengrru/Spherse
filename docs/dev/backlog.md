# Backlog

## 代码质量

- [ ] **恢复 React StrictMode 并修复 WebSocket effect cleanup**：`src/main.tsx` 当前移除了 StrictMode 以避免开发模式下双重 mount 导致 WebSocket 错误事件。正确做法是保留 StrictMode，在 `ChatPage` 的 `useEffect` 中用 ref 追踪活跃的 WebSocket 实例，忽略已关闭 socket 的事件。涉及文件：`packages/app/src/pages/ChatPage.tsx`、`packages/app/src/main.tsx`。

## 功能增强

- [ ] **Agent 编辑**：支持编辑已有 agent 定义文件（当前只能创建）
- [ ] **Agent 删除**：从 UI 删除 agent 定义文件
- [ ] **Session 历史**：在侧边栏显示历史 session 列表，支持恢复对话
- [ ] **多 Session**：同一 agent 开启多个对话
- [ ] **项目创建向导**：HomePage 区分"新建项目"和"打开项目"，支持设置项目名和默认模型
- [ ] **用户自定义主题**：支持从 `.pi/theme.css` 加载用户自定义 CSS 覆盖默认主题
- [ ] **多 Project 支持**：支持已导入项目的持久化，无需每次打开 app 重新手动导入
- [ ] **Skill 支持**：允许 agent 定义可复用的 skill（预设 prompt + tool 组合）
- [ ] **HTML Viewer Card**：在对话流中支持渲染 HTML 内容卡片

## 基础设施

- [ ] **electron-builder 打包**：配置生产构建和跨平台打包
- [ ] **better-sqlite3 rebuild 自动化**：在 postinstall 中自动为 Electron 重新编译 native 模块
- [ ] **E2E 测试**：Playwright 或 Spectron 端到端测试
- [ ] **重新考虑 dot 文件夹名字和内部组织结构**：当前使用 `.pi/`，需评估命名是否直观、内部文件组织是否合理
