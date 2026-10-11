# spherse CLI

终端宿主：`npx spherse server` 一键启动 Spherse server，浏览器访问线上托管的 web 端即可使用。面向在手机（Termux）或任意有 Node.js 的环境本地自部署的场景。CLI 作为第二 host 承担 desktop 主进程的最小职责（token、模型配置路径、项目注册），架构决策见 [ADR-0016](../../docs/dev/decisions/0016-cli-second-host.md)。

## 安装与启动

```bash
# 要求 Node.js >= 22.19.0
npx spherse@latest server            # 默认端口 53972，只绑 127.0.0.1
npx spherse server --port 8080       # 指定端口（被占用时报错退出，不静默换端口）
npm i -g spherse && spherse server   # 全局安装（更新：npm update -g spherse）
```

启动后回显 endpoint、token 与一键登录 URL（指向线上 web 端的深链，浏览器打开即自动登录）：

```
Spherse server running

  Endpoint:  http://127.0.0.1:53972
  Token:     <64 hex>

  Open in browser (login included):
  https://spherse.mengru.work/web/#/?base=...&token=...
```

首次使用需在 web 端「设置 → 模型」配置 provider API key。

## 命令

| 命令 | 说明 |
|---|---|
| `spherse server [--port <n>] [--home <dir>] [--frontend-url <url>]` | 启动 server；扫描注册 `<home>/projects/` 下全部项目（首启自动创建 `default` 项目） |
| `spherse new <name> [--home <dir>]` | 在 `<home>/projects/` 下创建项目目录，下次 `server` 启动时初始化并注册 |
| `spherse --version` / `spherse --help` | 版本 / 帮助 |

## 数据目录

`~/.spherse/`（优先级 `--home` > `SPHERSE_HOME` > 默认），与 desktop 应用数据天然隔离：

```
~/.spherse/
├── settings.json          # serverToken（唯一 key；删除后重启即轮换 token）
├── model-settings.json    # 模型配置（web 设置页读写）
├── server.lock            # 单实例锁（退出自动删除）
└── projects/<name>/       # 每个非 dotfile 子目录即一个项目，磁盘即注册清单
```

- 项目管理即目录操作：新建 = `spherse new <name>`（或直接 mkdir），删除 = 删目录
- token 等同密码，仅在本机回显与登录深链中出现，勿外传

## Termux（安卓）引导

```bash
pkg upgrade nodejs            # 确认 node -v >= 22.19.0
pkg install build-essential python   # better-sqlite3 无 android 预编译，首装需源码编译
npm i -g spherse
spherse server
```

后台保活建议使用 Termux 前台通知（`termux-wake-lock`）或 termux-services。

## 开发

```bash
npm run build --workspace=packages/cli    # esbuild bundle（产物 dist/cli.mjs + 一致性校验）
npm test --workspace=packages/cli         # 单测 + 装配测试（真实 server 实例）
npm run smoke --workspace=packages/cli    # bundle 冒烟（--version + 真实启动 + preview SDK 短路）
```

包内规则：

- 纯 `node:*` + `@spherse/core` / `@spherse/server` 依赖，不引入第三方 CLI 框架
- 用户可见输出（回显 / 错误）为英文短句，**不走 i18n**（终端工具输出，非 renderer UI chrome）
- 深链格式必须与 `packages/app/src/lib/connect-payload.ts` 的 `buildConnectUrl` 严格一致（`echo.test.ts` 黄金用例钉住）
- 发布 dependencies 与 core/server 的非 workspace 依赖并集保持一致，`build.mjs` 构建时校验 fail loud；版本必须与线上 web 端同版本发布（版本守卫 major/minor 失配会阻断连接）
