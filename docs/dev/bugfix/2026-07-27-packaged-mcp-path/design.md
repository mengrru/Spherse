# [Bug] 修复打包版 stdio MCP server 因 PATH 缺失而连接失败

## 现象

打包版 `Spherse.app` 从 Dock/Finder 启动后，配置的 stdio MCP server（如 `browser-use`，通过 `uvx` 启动）连接失败：

```
[WARN ] mcp server connection failed
[ERROR] mcp stdio server failed to start; captured stderr
stderr: × No solution found when resolving tool dependencies:
        the current Python version (3.9.6) does not satisfy Python>=3.11
```

`uvx` 拿到的是 macOS 系统 `/usr/bin/python3`（3.9.6），无法满足 `browser-use >=3.11`，子进程立即退出，MCP client 报 `MCP error -32000: Connection closed`。

`npm run dev` 下不复现。代码自 07a1903（MCP 引入）以来未改动。

## 根因分析

### 根因一：打包版 GUI 进程不继承登录 shell 的 PATH

macOS 从 Dock/Finder 启动的 GUI 应用只继承极简环境（PATH 通常仅 `/usr/bin:/bin:/usr/sbin:/sbin`），不含 `/opt/homebrew/bin`、`~/.pyenv/shims`、`~/.local/bin`、nvm 目录等。因此 `uvx` 发现的可执行集合与 shell 中不同：

| 来源 | uv 可见的 Python |
|------|------------------|
| 终端 / `npm run dev` | Homebrew 3.14.4、pyenv 3.14.2、系统 3.9.6（取最高 → 3.14） |
| 打包版 GUI 进程 | 仅 `/usr/bin/python3` → 3.9.6 |

`packages/desktop/electron/main.ts` 在 `app.whenReady()` 只调用 `restoreEnvFromSettings()`（注入 provider key、主题），**没有任何 PATH 修复逻辑**（已确认全仓库无 `fix-path`/`shell-env`/`launchctl` 相关代码）。

### 根因二：`buildTransport` 传 env 的方式会丢掉 `process.env`

`packages/core/src/mcp/mcp-client.ts:111-117`：

```ts
return new StdioClientTransport({
  command: config.command,
  args: config.args,
  env: config.env,          // ← 问题点
  cwd: config.cwd,
  stderr: "pipe",
});
```

Node `child_process.spawn` 规则：`env` 为 `undefined` 时继承 `process.env`；**为任意对象（含 `{}`）时，该对象即为子进程的完整环境**。因此用户一旦给某 server 配了任意自定义 env（哪怕只是 `FOO=bar`），该 server 子进程就**整个丢掉 `process.env`**——PATH、HOME、API key 全部消失。

即使修复了根因一（全局 PATH），只要用户在 MCP 配置里设了 env 字段，该 server 仍会因 PATH 缺失而失败。属同一根因（"stdio 子进程拿不到可用环境"）的另一种触发路径。

### 为什么"配置没变却突然坏了"

uv 的运行环境缓存（`~/.cache/uv/environments-v2/`）此前命中了一个 7/25 在 PATH 正常的上下文里构建好的 browser-use 环境，**直接复用、跳过 Python 重新解析**，从而遮蔽了打包版 PATH 缺失这一潜在问题。该缓存失效/被回收后，uv 重新解析，在极简 PATH 下只能选 3.9.6，问题暴露。带时间戳的证据：

| 证据 | 时间 | 含义 |
|------|------|------|
| `~/.cache/uv/wheels-v6/.../browser-use/0.13.6-py3-none-any` | Jul 25 14:20 | browser-use 0.13.6 在 PATH 正常时被下载缓存 |
| `~/.cache/uv/environments-v2/` 仅有的两条环境 | Jul 25 14:21 | uvx 曾为 browser-use 构建过可用环境 |
| 失败日志 | Jul 27 01:03 | 缓存失效后重新解析失败 |

## 修复方案

两个改动，治本 + 防御纵深。

### 改动 1 — desktop：启动时修复 `process.env.PATH`

**新文件** `packages/desktop/electron/fix-path.ts`，导出 `fixPath(): Promise<void>`：

- **守卫**：仅 `app.isPackaged === true` 且 `process.platform ∈ {darwin, linux}` 才执行。dev / test / win32 直接 no-op（dev 已继承 shell 环境；Windows GUI 进程从注册表继承系统 PATH，不存在同类问题）。
- **取 shell**：`process.env.SHELL`，darwin 缺省回退 `zsh`，linux 缺省回退 `bash`；都取不到则 warn 后 no-op。
- **拉取登录 shell 的 PATH**：`spawn(shell, ['-lic', 'echo $PATH'], { env: { ...process.env, TERM: 'dumb' }, stdio: ['ignore', 'pipe', 'ignore'] })`，包成 Promise + **3s 超时**。
  - `-lic`：login + interactive + command，确保 `.zshrc`/`.bashrc` 里的 PATH 导出也被加载。
  - `TERM: 'dumb'`：抑制 prompt / bracketed-paste 等交互转义。
- **解析**（纯函数 `parseShellPathPath(raw)`）：取 stdout 最后一行非空行 → 正则剥离 ANSI/控制字节（`\x1b\[[0-9;?]*[a-zA-Z]` 及其它 < 0x20 的控制字符，`\n` 除外）→ 按 `:` 切分 → 过滤空段。
- **合并**（纯函数 `mergePath(shellEntries, currentEntries)`）：`process.env.PATH = dedup(shellEntries ++ currentEntries)`，保序、去重、幂等（多次调用结果一致）。
- **容错**：spawn 异常 / 超时 / 非零退出 / 输出异常 → `log.warn` 后保留原 PATH，**绝不阻断 app 启动**。

**接线** `packages/desktop/electron/main.ts`，在 `app.whenReady()` 中、`restoreEnvFromSettings()` **之前**：

```ts
app.whenReady().then(async () => {
  await fixPath();
  restoreEnvFromSettings();
  // ...
});
```

异步 spawn，打包版启动多 ~50-150ms 一次性开销，可接受；不做结果缓存（YAGNI）。

### 改动 2 — core：`buildTransport` 以 `process.env` 为 env 基底

`packages/core/src/mcp/mcp-client.ts:111-117`：

```ts
return new StdioClientTransport({
  command: config.command,
  args: config.args,
  env: { ...process.env, ...config.env },   // ← 改为合并基底
  cwd: config.cwd,
  stderr: "pipe",
});
```

保证 stdio 子进程始终继承修好的 PATH（及其它基础环境变量）+ 用户自定义覆盖。`config.env` 为 `undefined` 时 `{ ...process.env, ...undefined }` 等价于 `{ ...process.env }`，行为对"未配 env"场景无回归。http/sse 传输不涉及 env，不受影响。

## 影响范围

- 新增 `packages/desktop/electron/fix-path.ts` + `packages/desktop/electron/fix-path.test.ts`
- `packages/desktop/electron/main.ts`：启动流程加一行 `await fixPath()`
- `packages/core/src/mcp/mcp-client.ts`：`buildTransport` env 合并（1 行改动）
- `packages/core/src/__tests__/mcp/connect-stdio.test.ts`：新增/扩展 env 合并断言
- 不影响：前端、路由、store、API contract、打包配置

## 测试

- **`packages/desktop/electron/fix-path.test.ts`**（vitest，仿 `updater.test.ts` mock `electron` 的 `app`）：
  - 纯函数 `parseShellPathPath`：含 ANSI 转义、prompt 噪声、空行、CRLF 的输入 → 正确切分
  - 纯函数 `mergePath`：去重、保序、幂等
  - `fixPath()` 在 `!app.isPackaged` / `win32` 时 no-op（不 spawn）
- **`packages/core/src/__tests__/mcp/connect-stdio.test.ts`**：断言配了 `config.env` 时，传给 transport 的 env 仍包含 `process.env` 的 key 且 `config.env` 覆盖生效（可通过 stub `StdioClientTransport` 或捕获 spawn 参数验证）。

## 验证方式

1. `npm run lint`
2. `npm test --workspace=packages/desktop`（fix-path 单测）
3. `npm test --workspace=packages/core`（env 合并断言）
4. 重新打包后手动验证：配置 `browser-use`（uvx）MCP server，确认连接成功、工具加载

## 文档同步

- 本 design.md
- `docs/official/project-structure.md`：desktop 目录索引补 `fix-path.ts`
- `docs/dev/backlog.md`：如有相关条目则更新状态
