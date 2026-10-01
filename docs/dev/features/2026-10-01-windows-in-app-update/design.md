# Windows 应用内更新

## 目标

Windows 自动检查和关于页手动检查均支持用户点击「后台下载」，下载在主进程运行，不依赖设置页是否打开。下载完成由全局 toast 提示「下载成功」，操作为「安装并重启」；关于页保留同一操作。macOS/Linux 继续使用 latest.json 检测与浏览器下载。

## 发布协议

- 安装包仍放在 OSS `spherse/releases/<version>/`；包括 CI 产出的 DMG、EXE、AppImage 和 DEB。
- Windows generic provider 按 `process.arch` 使用 `spherse/win/x64/` 或 `spherse/win/arm64/`，各目录提供 `latest.yml`。不合并架构，不依赖自动架构后缀。
- publish-oss 必须等全部构建上传结束；全部安装包上传 OSS 成功后才生成 latest.json 与两份 YAML，再上传元数据。先上传 YAML，最后上传 JSON；多对象不承诺原子切换，但每份清单所引用的包都已经存在。
- 提取可测试的 Node 清单生成脚本；YAML 含 version、files/url/sha512/size、releaseDate，SHA-512 对实际安装包字节计算并 Base64 编码。绝对 HTTPS URL 指向版本目录。
- 保持已发布 latest.json 格式兼容；正常 tag 与手动重发默认要求完整产物。历史 release 重发必须显式开启 `historical_assets` 才允许缺少 ARM64/Linux，且不能发布缺失安装包的 Windows feed。
- 串行化发布并防止旧版覆盖新版 stable 元数据；本次不重构 GitHub Release 可见性和 changelog 机制。

## 主进程与契约

- Windows 调用 setFeedURL + checkForUpdates，关闭自动下载、退出时自动安装与差量下载。macOS/Linux 不调用 electron-updater。
- UpdateState 增加可选 updateMode（inApp/external），状态增加 installing，errorPhase 增加 install。UpdateEvent 增加 `update-state {state}`；update-available 增加 updateMode。preload 转发新事件。
- Windows 的 update-state 是 renderer 状态事实源，保留版本、模式等元数据；已有 update-available 仅承担发现新版的通知语义。下载完成/失败 toast 由 update-state 驱动。非 Windows 保留原事件。
- 用户显式开始下载后，所有窗口订阅者立即收到 downloading/0 状态；进度、完成、取消与错误均广播。关闭关于页不取消下载。
- 检查与下载单飞；下载/已下载/安装期间不再检查覆盖状态。静默检查无新版/失败不通知；手动检查与静默检查重叠时必须响应手动请求。取消下载等待实际任务结束，忽略迟到完成/进度，不误报下载失败。
- IPC 异步错误不能成为未处理 rejection；主进程负责业务错误状态，renderer 对 IPC 传输失败兜底。
- 安装仅从 downloaded 进入，避免重复启动安装器。先停止 tunnel/server，再调用 quitAndInstall(true, true)，不能依赖该 API 之后的 before-quit 才开始清理。退出协调器让并发退出共享清理，清理期间继续阻止真正退出，完成后允许退出；正常退出保留超时保护。安装失败不得留下假成功状态。

## Renderer

- Windows 全局发现新版 toast 操作为「后台下载」，不打开浏览器。下载完成 toast 使用稳定 ID，操作「安装并重启」，不再弹阻塞对话框。
- 关于页 Windows available/downloading/downloaded/installing 使用行内状态与操作；downloaded 不因关闭页面或 dismiss toast 丢失。下载失败可重试，取消后可重新下载。
- 非 Windows 保持原有发现新版弹窗和外部链接行为。明确用 updateMode 区分能力，不靠 downloadUrl 缺失推断平台。
- 挂载先订阅再读取状态，迟到快照不得覆盖新事件；全局桥恢复 downloaded 通知。新增文案同步三个 locale。

## 验证

- 清单生成行为测试：实际哈希、大小、版本/架构 URL、完整产物、历史可选项；CI 顺序与失败门禁测试。
- 主进程：Windows generic feed、非 Windows 保持原状、静默/手动重叠、下载单飞、取消/失败重试、下载缓存无进度完成、安装前清理与重复退出。
- hook/组件：两个下载入口、状态同步、重新挂载、迟到快照、下载完成 toast 与关于页安装按钮、非 Windows 外链不变。
- lint、build、typecheck、相关单测与 i18n；可运行的 Electron smoke。Windows A→B 真实 NSIS 升级必须另在 Windows 机器/VM 验收，本地 macOS 无法证明安装器行为。

## 上线边界

旧版仍按原路径浏览器下载安装一次，之后才使用新更新机制。代码签名与差量更新不纳入本次；不自动强制重启、不更改用户项目数据格式。

## 设计评审处理

- important：退出协调器只允许一个终结动作拥有者；安装已接受时普通退出仅等待，普通退出先接受则不再启动安装。
- important：安装器交接不等于安装成功；清理后检测到交接失败使用普通重启恢复服务，不保留已停止服务的假可用 UI。进程退出后的 NSIS 失败属于 Windows 实机验收边界。
- medium：发布版本保护检查已有 JSON 与两份 YAML，避免某份 YAML 已升版但 JSON 尚未升版时旧任务回退 feed；同版本允许补齐失败发布。
- medium：开始下载即撤销发现新版 toast；主进程只允许 available 或 download-error 开始下载，拒绝 downloaded/installing 的陈旧操作。
- 实现评审：同版本重发在任何上传前对照既有 feed 校验实际 EXE 哈希/大小；concurrency 使用 `queue: max`（最多 100 pending）。Windows upToDate 重挂载恢复检查入口，无事件命令结束后重新取权威快照，避免初始快照竞态。安装交接前再次检查缓存文件可读；检查后删除的 TOCTOU 与退出后安装器行为保留为实机验证边界。
