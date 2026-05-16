# Backlog

- [ ] **单服务器多引擎重构**：将多 Fastify 实例合并为单实例多 engine，通过 URL 前缀区分项目，减少资源占用。参见 `docs/dev/features/2026-05-10-multi-project/design.md`

## 代码质量

- [ ] **恢复 React StrictMode 并修复 WebSocket effect cleanup**：`src/main.tsx` 当前移除了 StrictMode 以避免开发模式下双重 mount 导致 WebSocket 错误事件。正确做法是保留 StrictMode，在 `ChatPage` 的 `useEffect` 中用 ref 追踪活跃的 WebSocket 实例，忽略已关闭 socket 的事件。涉及文件：`packages/app/src/pages/ChatPage.tsx`、`packages/app/src/main.tsx`。

## 功能增强

- [x] **Agent 编辑**：支持编辑已有 agent 定义文件（当前只能创建）
- [x] **Agent 删除**：从 UI 删除 agent 定义文件
- [ ] **Session 删除**：从 UI 删除 session
- [x] **多 Session**：同一 agent 开启多个对话，侧边栏按 agent 分组展示 session 列表
- [ ] **项目创建向导**：HomePage 区分"新建项目"和"打开项目"，支持设置项目名和默认模型
- [x] **用户自定义主题**：支持从 `.spherse/theme.css` 加载用户自定义 CSS 覆盖默认主题
- [x] **多 Project 支持**：支持已导入项目的持久化，无需每次打开 app 重新手动导入
- [ ] **Skill 支持**：允许 agent 定义可复用的 skill（预设 prompt + tool 组合）
- [ ] **HTML Viewer Card**：在对话流中支持渲染 HTML 内容卡片
- [ ] **文件删除**：从文件浏览器删除文件/目录
- [ ] **文件编辑**：在应用内编辑文件内容
- [ ] **折叠工具调用过程**：将 agent 的 tool call 过程默认折叠，点击展开查看详情
- [ ] **流式输出响应**：agent 回复逐字流式显示
- [ ] **渲染响应 Markdown**：将 agent 回复渲染为格式化的 Markdown
- [x] **支持本地 HTML 文件页面渲染**：在应用内直接渲染本地 HTML 文件
- [ ] **支持 Agent 定时执行**：按 cron 表达式定时触发 agent 运行
- [ ] **支持文件版本控制**：集成 git 进行文件版本管理，增加 git tool 供 LLM 调用
- [ ] **划取文本发起会话**：通过在文件内容上划取文本直接向指定 agent 发起会话
- [x] **增加 edit file tool**：为 agent 提供编辑文件的工具（字符串替换模式：old_string + new_string）
- [ ] **Agent context 预注入**：agent profile 的 `context` 字段指定文件列表，buildAgent 时读取这些文件内容注入 systemPrompt，使 agent 从第一轮对话起就了解相关上下文

## 基础设施

- [ ] **electron-builder 打包**：配置生产构建和跨平台打包
- [x] **better-sqlite3 rebuild 自动化**：在 postinstall 中自动为 Electron 重新编译 native 模块
- [ ] **E2E 测试**：Playwright 或 Spectron 端到端测试
- [x] **重新考虑 dot 文件夹名字和内部组织结构**：`.pi/` → `.spherse/`
- [ ] **Chat Debug 模式**：在对话界面提供 debug 模式，展示 agent 的 tool call 请求、响应、system prompt 等原始数据，方便开发和调试
