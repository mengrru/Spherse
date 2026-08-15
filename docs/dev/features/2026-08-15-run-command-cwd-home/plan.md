# 实施计划：run_command cwd 开放到用户主目录

Design doc：`docs/dev/features/2026-08-15-run-command-cwd-home/design.md`（含行为矩阵与风险评估，实现前必读）。

改动面：1 个工具源文件 + 1 个测试文件 + 2 处文档。无 contracts / i18n / 前端 / server 改动。

---

## Task 1 — core：新增 `expandHome` / `resolveCommandCwd` 并接入 execute

**文件**：`packages/core/src/tools/run-command.ts`

1. 新增 import：`os`（`node:os`）、`path`（`node:path`）；`path-safety.js` 的 import 从 `resolveProjectPath` 改为 `isPathInside`；新增 `AccessDeniedError`（`../errors.js`）。
2. 新增两个导出的纯函数（放在 `clampTimeout` 附近，签名与 design doc §详细设计-1 一致，`resolveCommandCwd` 增加可注入的 `home` 参数便于测试）：

```ts
export function expandHome(input: string, home = os.homedir()): string {
  if (input === "~") return home;
  if (input.startsWith("~/")) return path.join(home, input.slice(2));
  return input;
}

export function resolveCommandCwd(projectRoot: string, input: string, home = os.homedir()): string {
  const expanded = expandHome(input, home);
  const resolved = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(projectRoot, expanded);
  if (!isPathInside(home, resolved) && !isPathInside(projectRoot, resolved)) {
    throw new AccessDeniedError(`cwd outside user home directory: ${input}`);
  }
  return resolved;
}
```

3. `execute` 内 L122 `const cwd = resolveProjectPath(projectRoot, cwdRel);` 替换为 `const cwd = resolveCommandCwd(projectRoot, cwdRel);`。其余（`details.cwd` 回传入参原串、超时/截断/杀树）不动。
4. cwd 参数 schema description 更新为：

```
Working directory. Relative paths resolve against the project root; absolute paths and ~/ paths are allowed anywhere within the user's home directory. Defaults to the project root.
```

**注意**：`path-safety.ts` 不改（保持项目边界单一职责）。

## Task 2 — core：更新单元测试

**文件**：`packages/core/src/__tests__/tools/run-command.test.ts`

1. 新增 `describe("resolveCommandCwd")` 纯函数用例（用注入的 `home`，如 `path.join(os.tmpdir(), "fake-home-xxx")`，不碰真实 home）：
   - `"."` / `"src"` → 项目内路径（相对基准 = projectRoot）
   - `"~"` → home；`"~/Documents"` → `path.join(home, "Documents")`
   - `"~other/x"` → 按字面解析（相对 projectRoot），不展开
   - home 内绝对路径 → 原样 resolve 放行；home 外绝对路径（如 `path.sep`）→ `rejects.toThrow(AccessDeniedError)`
   - 相对路径逃出 projectRoot 但落在 home 内（构造 `path.relative(projectRoot, homeJoinSub)`）→ 放行；逃出 home 且在项目外 → 拒绝
   - `expandHome` 单独用例：`"~"`、`"~/x"`、`"~x"`、普通字符串原样返回
2. 改写集成用例 `rejects cwd that escapes the project root`（L60-65）→ 名为 `rejects cwd outside the allowed roots`：入参改为 `cwd: "/"`（resolve 后在 home 与项目外，跨平台确定性拒绝），断言 `rejects.toThrow()`。
3. 新增集成用例：`cwd: "~"` 时执行 `pwd`，断言 `details.cwd === "~"` 且 stdout 含 `os.homedir()`（只读不写）。
4. 保留用例 `uses project-relative cwd`（L67-73）不变（默认 `.` 行为未变）。

**环境注意**：macOS 下 tmpdir（`/var/folders/...`）在 home 外，projectRoot 兜底分支天然覆盖；若在 home 内机器上跑（Linux `~/.cache` 等），纯函数用例用注入 home 即不受影响。

## Task 3 — 文档同步

1. `docs/official/architecture.md` L24：「cwd 锁项目根」改为「cwd 允许用户主目录内任意路径（含项目根；词法边界，仅防无心之失）」，其余安全模型描述不动。
2. `docs/dev/backlog.md`：在 L69（Agent Shell Tool 条目）后新增条目（格式对齐相邻条目，标 `[x]`）：

```
- [x] **run_command cwd 开放到用户主目录**：cwd 边界从项目根放宽为「用户主目录 ∪ 项目根」（词法判断，复用 isPathInside），相对路径仍以项目根为基准，支持 ~ 展开；home 外路径仍拒绝。审批/opt-in/超时/截断等安全模型不变。参见 `docs/dev/features/2026-08-15-run-command-cwd-home/design.md`
```

## 验证

```bash
npm test --workspace=packages/core
npm run lint
```

全部通过即完成。无需 E2E（现状无 run_command E2E，本次无 UI/启动链路改动）。
