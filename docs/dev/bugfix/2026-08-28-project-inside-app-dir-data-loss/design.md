# 项目存放在应用安装目录导致更新后数据丢失

## 现象

用户反馈：更新 Spherse 后，若项目文件夹存储在 Spherse 文件夹（应用安装目录）下，项目会被重置清空——重开应用后项目变回空的新项目，sessions / agents / 数据全部丢失。

## 根因

数据丢失发生在**安装器替换应用目录**这一步，应用自身代码并未执行任何删除：

1. **Windows（NSIS）**：electron-builder 生成的卸载器在卸载/更新时会执行 `RMDir /r $INSTDIR`（`app-builder-lib/templates/nsis/uninstaller.nsh:187`），**递归删除整个安装目录**，包括用户放入的任意文件。更新流程 = 新安装器静默执行旧卸载器再重装（`isUpdated` 分支先 rename 到 `$PLUGINSDIR\old-install` 再删，结果一致）。本项目 NSIS 配置为 `oneClick: false` + `allowToChangeInstallationDirectory: true`（`electron-builder.yml`），用户可将应用装到自定义目录（如 `D:\Spherse`），并在其中存放项目文件夹。
2. **macOS（DMG）**：更新 = 用新 `Spherse.app` 替换整个 bundle，bundle 内用户文件同样丢失（少见，但文件选择器可达）。
3. **丢失后的二次伤害**：安装目录被清空后，`restore-projects`（`electron/ipc/project.ts:70`）重新注册项目路径，`assembleProject`（`core/src/factory.ts:61-71`）发现 `project.yaml` 不存在 → 抛 `ProjectConfigNotFoundError` → 按新项目重建空 `.spherse`——项目由此呈现"重置清空"，且用户无感知。

`userData`（`%APPDATA%\Spherse` / `~/Library/Application Support/Spherse`）不受影响（`deleteAppDataOnUninstall` 未开启，默认 false），settings 安全。

## 修复方案（方案 A：打开时拦截）

在项目入口拦截「易失区」内的路径，弹警告框（默认取消），从源头防止用户把项目放进会被更新清空的位置。不动 core/server、不改安装器。

### 1. 新增 `packages/desktop/electron/unsafe-location.ts`

- `getUnsafeZoneRoot(): string | null`：
  - 非 packaged（dev）返回 `null`（不拦截，避免误伤 electron 二进制所在目录）；
  - Windows：`path.win32.dirname(process.execPath)`（安装目录，NSIS 卸载器的 `RMDir /r` 作用域）。**显式用 `path.win32`**：Linux CI 上 `node:path` 是 POSIX 实现，平台无关的 zone 计算必须按 `process.platform` 选 path 实现，保证 Linux CI 上也能词法级测试 Windows 分支；
  - macOS：从 `process.execPath`（`…/Spherse.app/Contents/MacOS/Spherse`）逐级向上找到 `.app` 目录（不区分大小写比较后缀，macOS 文件系统大小写不敏感）。更新替换的是整个 bundle，故 zone = `.app` 目录；
  - macOS 找不到 `.app` 祖先（packaged 下不可达的防御分支）与 Linux（当前无产品目标）→ 返回 `null`（无法确定易失区时不拦截，避免误报）。
- `isInsideUnsafeZone(target: string): boolean`：zone 为 null → false；否则 `isPathInside(zone, target)`（复用 `@spherse/core` 的 `isPathInside`，符合仓库路径安全红线，禁止 startsWith 前缀判断）。`isPathInside` 在运行时与所选 path 实现同语义（Windows 上 `node:path` 即 win32），Linux CI 上的 win32 语义差异仅影响测试覆盖范围，见「测试」。

### 2. `electron/ipc/project.ts`：`confirmUnsafeLocation` helper + 两处 guard

- 新增导出 `confirmUnsafeLocation(targetPath: string, win: BrowserWindow | null): Promise<boolean>`（供测试）：`isInsideUnsafeZone` 未命中 → true；命中 → `dialog.showMessageBox`（type: `"warning"`，按钮 [仍然打开, 取消]，`defaultId`/`cancelId` = 1，`noLink: true`），返回 `response === 0`。`win` 为 null 时调用无 parent 的 `dialog.showMessageBox(options)` 重载（Electron 允许，不阻塞行为）。
- `open-project`：`registerProject` 之前 `await confirmUnsafeLocation(projectRoot, win)`，未确认 → 返回 `null`（与 `select-directory` 取消同语义，renderer `openProject` 返回 null 无副作用）。
- `open-sample-project`：`showOpenDialog` 拿到 `parentDir` 之后、`mkdirSync`（`project.ts:165`）之前检查，未确认 → 返回 `null`（复制尚未发生，零代价）。

### 3. i18n（三语言各 5 个新 key）

- `project.unsafeLocation.title`：警告框标题
- `project.unsafeLocation.message`：解释「该位置位于 Spherse 应用目录内，更新 Spherse 时该位置会被覆盖清空，项目数据会丢失；建议将项目移动到其他位置」（措辞不区分 Windows「删安装目录」/ macOS「替换 bundle」的精确语义，两边都成立）
- `project.unsafeLocation.openAnyway`：按钮「仍然打开」
- `project.unsafeLocation.startupMessage`：启动存量警告正文，`{names}` 插值项目名列表
- `project.unsafeLocation.acknowledge`：启动警告框按钮「知道了」
- 「取消」按钮复用 `common.cancel`

### 4. 存量项目启动警告（补齐 `setActiveProject` 切换路径的盲区）

`restore-projects` 恢复完成后，对恢复结果中位于易失区的项目弹一次原生警告框（type: `"warning"`，正文列出项目名，按钮「知道了」）：

- **每会话一次**：`registerProjectIpc` 闭包内 `unsafeStartupWarningShown` 标志，`refreshProjects`（断线重连补偿）再次触发 `restore-projects` 不会重复弹；
- 弹框失败（异常）不清标志、记日志，下次恢复重试——不因弹框故障丢提示；
- dev 模式 `isInsideUnsafeZone` 恒 false，无弹框，E2E 不受影响。

## 影响面

- desktop：新增 `electron/unsafe-location.ts` + `unsafe-location.test.ts`；`electron/ipc/project.ts` guard + 存量启动警告 + 新增 `electron/ipc/project.test.ts`；`electron/types.ts` 的 `ElectronAPI.openProject` 返回类型加 `| null`
- app：`src/lib/host-bridge.ts` 的 `ProjectHostApi.openProject` 返回类型加 `| null`（仅类型，无行为改动；`app-store.ts:184-185` 已按 null 处理）
- i18n：zh-CN / zh-TW / en 各 5 个新 key
- core / server：不改

## 测试

- `electron/unsafe-location.test.ts`（vitest，仿 `updater.test.ts` 用 `vi.hoisted` + `vi.mock("electron")`，`process.execPath` 可 override）：
  - dev（`isPackaged: false`）→ zone null、`isInsideUnsafeZone` 恒 false；
  - Windows packaged → zone = `path.win32.dirname(execPath)`（词法断言：用 `path.win32` 构造 fixture 与期望值；Linux CI 上 `isPathInside` 是 POSIX 实现，Windows 分支只做 zone 词法断言，真正的 win32 inside 语义由运行时 `node:path`=win32 保证——与 macOS 分支共享同一段委托逻辑）；
  - macOS packaged（POSIX 路径，Linux CI 可全量测）→ zone = `.app` bundle 目录；bundle 内子路径命中、bundle 外不命中、**边界（target == zone 本身）命中**（`RMDir /r $INSTDIR` 连安装目录一起删，语义正确）；
  - execPath 无 `.app` 祖先（防御分支）→ zone null、不拦截。
- `electron/ipc/project.test.ts`（新增，仿 `ipc/mobile.test.ts` 的 handlers Map + `vi.mock` 模式）：mock `electron`（ipcMain/dialog/shell）、`../server.js`、`../settings.js`、`../sample-projects.js`、`./open-file-path.js`、`@spherse/i18n`、`node:fs` 的 `cpSync/mkdirSync/existsSync`：
  - `open-project`：unsafe + 用户点取消 → handler 返回 null 且 `registerProject` 未调用；点「仍然打开」→ 正常调用 `registerProject`；
  - `open-sample-project`：unsafe `parentDir` + 取消 → 返回 null 且 `cpSync` 未调用；
  - 安全路径 → 不弹框直接走原有流程；
  - `restore-projects`：unsafe 恢复结果 → 弹一次列出项目名的警告（断言 detail 含名字）；同会话再次恢复不再弹；无 unsafe 项目不弹；弹框抛错不置位标志、下次恢复重试。
- i18n：`npm run check:i18n` + `npm test --workspace=packages/i18n`。
- E2E（按 AGENTS.md 按影响面选择）：dev 模式 `isPackaged=false` 下 guard 恒 no-op，改动低风险；跑 `app-launch.spec.ts`、`project-close.spec.ts` 确认 open/close 流程无回归。

## 行为变更说明

- 新增/示例项目：选中的文件夹位于易失区时弹警告框，默认取消，选「仍然打开」可强行继续（用户可能有正当理由临时放置）。
- **存量项目**：启动恢复时若已有打开项目位于易失区，弹一次警告列出项目名（每会话一次），提示迁移；活动栏切换走 `setActiveProject` 不触 IPC 的盲区由此补齐。
- 已存在的易失区项目在更新被清空后，仍会被 `restore-projects` 重建为空项目——本次不改（数据已丢，恢复超出本次范围）。

## 不做的事（记录理由，均写入 backlog）

- **NSIS `customRemoveFiles` 只删应用自有文件**：该宏替换卸载器「删除已装文件」整块逻辑（`uninstaller.nsh:160-188`），需在自定义脚本里维护完整文件清单，与未来自动更新/文件布局变化强耦合，且实现不当会让更新残留旧文件，不推荐。
- **macOS `/Volumes` 挂载卷检测**：独立一类问题（挂载卷卸载即丢），本次不混入；记为 backlog。
- **更新前拦截**（download/install 时检查）：当前更新为浏览器下载 + 手动安装，应用内无介入点；待 backlog #149 恢复应用内下载后再评估。

## 文档同步（实现完成后执行 doc-sync）

- `docs/official/project-structure.md`：新增 `packages/desktop/electron/unsafe-location.ts` 与两个测试文件
- `docs/dev/backlog.md`：新增「macOS /Volumes 挂载卷项目检测」条目（「启动时对存量易失区项目弹警告」已随本次实现落地，不新增）
