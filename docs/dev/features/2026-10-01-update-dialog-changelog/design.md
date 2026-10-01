# 外部更新弹窗日志

## 范围

macOS/Linux 在关于页手动检查到新版本后，从同一 OSS 的 `changelog.json` 读取目标版本日志，复用现有 `releaseNotes` 与 Markdown 弹窗。不修改 Windows、自动提醒、下载地址或 CI。基于最新 origin/dev 独立实现；Windows 更新 PR #125 尚未合入。

## 实现

- Electron 主进程在确认新版后读取日志，3 秒超时覆盖 fetch 与响应体读取。异常单独吞掉，返回空日志，不将可选日志失败升级为检查失败。
- 对实际使用的 releases/version/notes/text 做运行时校验；版本 trim 并去掉可选 v 后精确匹配，不取第一条、不聚合其他版本。无匹配、空日志或非法结构返回空串。
- 只显示每条 note.text，保留顺序；折叠条目内空白，转义 Markdown 标点，将纯文本转换为列表，避免注入图片/显式 Markdown 链接/HTML。既有 GFM 自动识别裸 URL/email，点击经 host bridge 打开，不在 app 内导航。不新增 UI 文案或类型标签。
- releaseNotes 同时进入状态与 update-available 事件，renderer 不新增获取逻辑；有内容才显示已有更新日志区块。
- 新增异步等待不能让先发起的手动检查覆盖较新的检查结果：用请求序号丢弃过期手动结果，静默检查不使手动结果失效。

## 验证

主进程测试覆盖 darwin/linux 精确版本匹配、v 前缀、列表转义、非法数据、HTTP/网络/JSON/超时降级、下载地址保留、静默/Windows/无新版不请求日志、迟到手动检查结果丢弃。复用已有弹窗渲染测试验证 releaseNotes 的显示与下载按钮。运行 desktop/app 相关单测、lint、build/typecheck，同步 desktop 架构和目录索引。

## 实施结果

- 设计评审未发现分级问题；实现评审提出并发测试缺口、测试名称与文档过时，已补齐静默重叠及旧 manifest 无更新/异常回归测试并修正文字。
- `npm run verify` 通过：338 个测试文件、3372 个测试；lint 无错误，17 条基线已有告警。全 workspace build/typecheck 与 i18n 校验通过。
- 日志 URL 在调研阶段实际读取成功；失败/超时与平台差异通过主进程测试验证，列表及链接交互通过真实 Markdown 组件测试验证。本次未运行 Electron E2E 或打包升级，未变更布局/安装机制。
- doc-sync：架构行为和新增设计目录已同步；复用既有 IPC 字段、更新内容标题，无新用户文案、数据格式、package 边界、主题 hook 或 backlog 完成项，故不改 locale/data-conventions/ADR/package README/theme skill/backlog。未新增命令或通用规范。
- 改动保留在独立分支，未自动提交、推送或更新 PR #125；两项均修改 updater，合入时需保留 Windows 更新路径与此处外部更新日志读取。
