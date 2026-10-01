# ADR-0015：Windows 使用架构隔离的 OSS 更新 feed

- 状态：accepted
- 日期：2026-10-01
- 影响：desktop、app、i18n、release CI

## 背景

浏览器下载不能提供应用内下载与重启安装；Windows 已使用 NSIS，electron-updater 支持 generic 静态源。

## 决策

- Windows 按进程架构选择独立 OSS feed，用户确认后全量下载与安装；macOS/Linux 继续外部下载。
- 所有安装包上传成功后才生成并发布 YAML/JSON；stable 发布串行，拒绝倒退和同版本已引用 EXE 字节变更。
- 主进程拥有下载状态，退出协调器先清理服务再启动安装器，renderer 只订阅与发命令。

## 后果

无需 Windows 多架构清单合并或额外更新服务；增加发布完整性与真实 NSIS 升级验收责任，未引入差量更新和强制重启。

原始记录：[设计](../features/2026-10-01-windows-in-app-update/design.md)。
