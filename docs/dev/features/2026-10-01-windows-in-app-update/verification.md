# 验证与评审

## 自动验证

- `npm run verify`：通过，341 个测试文件、3492 个测试；覆盖 lint、全 workspace build/typecheck/unit tests 与 i18n。lint 有 16 条既有非本次文件告警，无错误；构建保留既有 chunk 大小/Browserslist 提示。
- `npm run test:e2e --workspace=packages/desktop -- e2e/close-to-tray.spec.ts`：macOS arm64 真实 Electron 2 个场景通过。
- `npm run pack -w @spherse/desktop && SPHERSE_SMOKE=1 npm run test:smoke -w @spherse/desktop`：macOS arm64 打包与 1 个打包启动/renderer/server health 场景通过；本机无签名证书，打包未签名。
- `git diff --check`：通过。
- 发布测试通过真实 electron-updater GenericProvider 解析生成的两份 feed；未向生产 OSS 写入任何对象。

## 代码评审

两个独立审查分别覆盖 updater/UI/退出链与发布 pipeline。1 important、4 medium 与文档同步项均修复，复审确认关闭，抽查未发现新的 important/critical。

- important：安装缓存 EXE 消失会被依赖 ENOENT 回退吞掉，增加清理后、启动安装器前的当前缓存路径可读性检查；失败进入普通重启恢复。
- medium：Windows upToDate 跨挂载锁死检查入口，恢复 idle；初始快照与提前检查命令竞态，通过无新事件时补读权威状态收口。
- medium：concurrency 默认单 pending 被替换，改用 `queue: max`；同版本重发上传前校验既有 feed 引用 EXE 的哈希/大小。
- 手动重发默认要求完整产物；旧 release 缺 ARM64/Linux 时才显式使用 `historical_assets=true`，不自动以历史兼容放宽所有 dispatch。

## 文档同步

| 检查面 | 结果 |
|---|---|
| 新文件与目录 | 已更新 project-structure：publisher、三个测试文件、设计记录与 ADR |
| 架构/装配/IPC | 已更新 desktop.md；新增 ADR-0015 并入索引 |
| 数据格式/存储 | 已更新 data-conventions 的 OSS 清单路径与编码；用户本地持久化格式无变更 |
| 术语 | 无新领域概念，不修改 glossary |
| 包内规范 | 未新增包内编码规范，不修改 package README |
| 文案 | 5 个新 key 在 zh-CN/zh-TW/en 同步，i18n 校验通过 |
| 主题/聊天 DOM | 无 token、主题 hook 或聊天 DOM 变更，不修改 theme skills |
| presets | 未修改 presets 源；verify 中常规同步构建通过 |
| backlog | 删除恢复 Windows feed 条目，补充 Windows/OSS 实机发布验收 |
| 用户修正规范 | 发布先包后清单属于本功能协议，已落 desktop.md，不新增仓库通用规则 |
| 工具/验证 | 沿用原命令；testing.md 补充 Windows A→B 验收要求 |

## 未覆盖边界

- 本机 macOS，未执行 Windows x64/arm64 NSIS A→B、UAC、自定义目录与实际重启验收；不能以本地 mock/Electron smoke 代替。
- 未触发 GitHub Actions 发版或真实 OSS 上传，发布前应使用隔离 prefix 验证权限、可达性和全链路。
- 文件检查后至安装器启动仍有被外部删除/隔离的 TOCTOU；旧进程退出后无法确认 NSIS 安装成功。记录在 backlog，不引入依赖内部 override。
- 三份元数据不是跨对象事务，部分上传失败可能暂时指向不同版本，但所有已发布清单引用的包均已上传；重试受版本与字节保护。
- 未 commit、push 或创建 PR；用户本次授权范围为实现。
