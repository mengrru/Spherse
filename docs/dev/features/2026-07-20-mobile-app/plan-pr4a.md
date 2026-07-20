# PR4a 实施计划：移动端 PWA 最小可用版

> **对应 design：** `design-pr4a.md`
>
> **目标：** 让 web 端能完成「扫码 / 手动连接 → 看到项目列表 → 进入项目 → 聊天」的完整链路。UI 粗糙可接受，layout 只做最小化容器。
>
> **粒度说明：** 按本 repo 现有 `plan.md` 风格，任务级拆分，每项给出目标、关键文件、验证方式，不展开 step-by-step。

---

## Phase W-A：`WebHostBridge` 实现 `ProjectHostApi` 子集

### Task W-A1：扩展 `WebHostBridge` 实现 `project`

**目标**：让 `app-store` 在 web 端透明运行，能拉到项目列表。

**关键文件**：
- `packages/web/src/host-bridge-web.ts`：
  - 实现 `project: ProjectHostApi`（不再 undefined）
  - `restoreProjects()`：`fetch GET /api/projects` 拿 id/name 列表，并发 `GET /api/projects/:id/info` 拿 rootPath，组装成 `RestoredProject[]`（`lastOpened` 填 `new Date(0).toISOString()` 占位）
  - `getLastActiveProject()` / `setLastActiveProject(id)`：localStorage `spherse:last-active-project`
  - 其余方法（`selectDirectory` / `openProject` / `openSampleProject` / `closeProject` / `openProjectFolder` / `addOpenProject` / `selectSkillZip` / `getSampleManifest`）：返回 `null` / `undefined` / `[]` / `Promise.resolve()`
  - HTTP 请求需带 `Authorization: Bearer <token>` header（从 `getServerAccessToken()` 取）
- 注意：fetch 失败 / 401 时的错误处理——`restoreProjects` 应返回空数组并打 warn，不抛（保持 `app-store.restoreProjects` 的 `Promise<string | null>` 契约）

**验证**：
- `npm run lint --workspace=packages/web` 通过
- 类型检查通过（`bridge.project` 类型从 `undefined` 变为 `ProjectHostApi`，不能影响其它消费方）
- 手动 dev 启动 web，浏览器 devtools 看到 `GET /api/projects` 请求发出（虽未连接会失败，但请求形态正确）

---

## Phase W-B：连接页（MobileConnectPage）

### Task W-B1：实现扫码 + 手动输入

**目标**：web 端首次访问 `/` 时显示连接入口，连接成功后写 localStorage 并触发 init。

**关键文件**：
- `packages/web/src/pages/MobileConnectPage.tsx`：
  - 默认显示两个按钮：「扫码连接」/「手动输入」
  - 「扫码连接」：点击后请求 `getUserMedia({ video: { facingMode: "environment" } })`，渲染 `<video>` + canvas，用 `BarcodeDetector` 优先（不支持时降级 `jsQR`）每帧解码；解析成功后调用 `handleConnect(base, token)`
  - 「手动输入」：展开两个 input（baseUrl、token）+ 「连接」按钮，提交后调用 `handleConnect(base, token)`
  - `handleConnect`：写入 localStorage `spherse:connection = JSON.stringify({ baseUrl, token })`；调用 `useAppStore.getState().refreshConnection(bridge)` + `restoreProjects(bridge)`；成功后 `navigate("/")` 重新走 router（此时 localStorage 已有连接信息，应进入项目列表分支）
  - 错误处理：扫码失败（权限拒绝、无摄像头）显示提示并引导用手动输入；连接失败（fetch /api/projects 报错）显示 toast
- 依赖：`jsQR`（npm 依赖，~30KB）；`BarcodeDetector` 是浏览器原生 API（TS 类型在 `dom` lib 里，无需额外依赖）
- `packages/web/package.json`：加 `jsqr` 依赖

**验证**：
- 扫码成功后 localStorage `spherse:connection` 被正确写入
- 手动输入合法 base + token 后能连接成功
- 连接失败有 toast 提示
- 摄像头权限拒绝时引导到手动输入

---

## Phase W-C：共享层 route + shell 分支

### Task W-C1：`OnboardingPage` route adapter 按 kind 分支

**目标**：`/` 路由在 web 端渲染 `MobileConnectPage`，桌面端渲染原 OnboardingPageFeature。

**关键文件**：
- `packages/app/src/pages/OnboardingPage.tsx`：
  - `const { kind } = useHostBridge()`
  - `if (kind === "web") return <MobileConnectPage />`（从 `@spherse/web/src/pages/MobileConnectPage` deep import——或者通过 `HostBridge` 注入组件，避免 app → web 的反向依赖）
  - 否则继续渲染 `<FeatureGate feature="open-project"><OnboardingPageFeature /></FeatureGate>`

  **反向依赖处理**：app 层 import web 层会形成循环（app → web → app）。两种方案：
  - (a) 在 `HostBridge` 上加一个可选的 `renderConnectPage?(): ReactNode` 方法，web shell 注入实现，共享 OnboardingPage 适配器调 `bridge.renderConnectPage?.()`
  - (b) 把 connect page 的组件类型通过 Context 注入
  
  **推荐 (a)**：与 HostBridge 既有设计一致（其它 host-specific 逻辑都走 bridge）。`renderConnectPage` 是 web 专属，desktop 不实现。

  调整后：
  - `packages/app/src/lib/host-bridge.ts`：`HostBridge` 加 `renderConnectPage?(): ReactNode`
  - `packages/web/src/host-bridge-web.ts`：`renderConnectPage: () => <MobileConnectPage />`（MobileConnectPage 通过 web shell 内部组装，避免 app 反向 import web）
  - `packages/app/src/pages/OnboardingPage.tsx`：`if (kind === "web") return <>{bridge.renderConnectPage?.()}</>`

**验证**：
- 桌面 `/` 仍渲染原 OnboardingPage
- web `/` 渲染 MobileConnectPage
- 没有循环依赖警告

---

### Task W-C2：`App.tsx` 按 kind 切 layout

**目标**：web 端不渲染 ActivityBar，改用 MobileLayout。

**关键文件**：
- `packages/app/src/App.tsx`：
  - `const { kind } = useHostBridge()`
  - layout 渲染分支：
    ```tsx
    {kind === "electron" ? (
      <ActivityBar ... />
    ) : (
      <MobileLayout />
    )}
    ```
  - `MobileLayout` 通过 `HostBridge` 注入（同 W-C1 思路）：`HostBridge` 加 `renderMobileLayout?(children: ReactNode): ReactNode`，web shell 注入实现
  - 或者直接 deep import（`@spherse/web/src/layouts/MobileLayout`）—— 但这会引入反向依赖，所以仍走 bridge 注入
  
  调整：
  - `HostBridge` 加 `renderMobileLayout?(children: ReactNode): ReactNode`（children 是 `<Outlet />`）
  - web shell 注入实现：`renderMobileLayout: (children) => <MobileLayout>{children}</MobileLayout>`
  - `App.tsx` 调用：`bridge.renderMobileLayout ? bridge.renderMobileLayout(<Outlet />) : <><ActivityBar /><Outlet /></>`

**验证**：
- 桌面 layout 完全不变（ActivityBar + Outlet）
- web layout 走 MobileLayout（底部按钮 + drawer + Outlet）

---

## Phase W-D：`MobileLayout` 极简版

### Task W-D1：实现极简移动 layout

**目标**：web shell 提供最小可用移动 layout，能打开 ProjectPanel drawer。

**关键文件**：
- `packages/web/src/layouts/MobileLayout.tsx`：
  - 接受 `children: ReactNode`
  - 渲染 `<div className="flex flex-col h-screen">` + children + 底部按钮区
  - 底部按钮区：单个「项目」按钮（图标 + 文案），点击切换 `useState<boolean>` 控制 Sheet/Drawer 打开
  - Sheet/Drawer：用 shadcn `Sheet`（side="left"），内容 `<ProjectPanel />`（直接复用 `features/project-panel`）
  - 不做 settings tab、不做 bottom-sheet Dialog、不做手势
- shadcn Sheet 组件：检查 `packages/app/src/components/ui/` 是否已有，没有则在 web shell 局部包装（或先复用 `Dialog`）

**验证**：
- 底部按钮可见，点击后 Sheet 从左侧滑出展示 ProjectPanel
- ProjectPanel 内的 agent-session-list / user-file-panel / skill-panel 正常渲染（已 gate 砍掉 mutate 入口）
- 关闭 Sheet 后主区域恢复可见

---

## Phase W-E：依赖与构建配置

### Task W-E1：加 `jsqr` 依赖

**目标**：扫码兜底实现可用。

**关键文件**：
- `packages/web/package.json`：`dependencies` 加 `"jsqr": "^3.x"`
- `packages/web/src/pages/MobileConnectPage.tsx`：`import jsQR from "jsqr"`

**验证**：
- `npm install` 不报错
- `npm run build --workspace=packages/web` 通过

---

## Phase W-F：集成验证

### Task W-F1：端到端实测

**目标**：完整链路打通。

**步骤**：
1. 启动桌面端：`npm run dev`（桌面 QR 面板生成 `spherse://connect?base=...&token=...`）
2. 启动 web 端：`npm run dev --workspace=packages/web`（vite dev server，浏览器访问）
3. 浏览器打开 web 端 URL：应显示 MobileConnectPage
4. 「手动输入」分支（dev 环境推荐，避免 dev server 端口冲突）：
   - 桌面 QR 上读出 base 和 token
   - 在 MobileConnectPage 手动输入，点击「连接」
   - 期望：localStorage 写入、跳到项目列表（ActivityBar 显示 avatar）、能点击 avatar 进入项目
5. 进入项目后：
   - ProjectPanel（底部「项目」按钮打开 drawer）正常
   - Welcome page 正常
   - 选 agent + 创建 session + 发消息 + 收到流式回复
6. 「扫码」分支：用另一台设备 / 浏览器窗口展示 QR 图片，当前浏览器用摄像头扫
   - 期望：解析成功、连接建立、流程同上
7. 错误路径：
   - 错误 token：toast 报错
   - 断开 server：拉项目失败有提示

**验证**：
- 上述每步行为符合预期
- 浏览器 console 无未捕获错误
- 桌面端无回归

---

## Phase W-G：lint / 类型 / 测试

### Task W-G1：完整自测

**目标**：所有验证命令通过。

**执行**：
- `npm install`
- `npm run lint`
- `npm run build`（含 desktop 和 web）
- `npm test --workspace=packages/app`
- `npm test --workspace=packages/desktop`
- 手动跑 Task W-F1 的端到端用例

**新增测试覆盖**（推荐但不强制）：
- `host-bridge-web.ts`：mock fetch，验证 `restoreProjects` 正确组装 `RestoredProject[]`、localStorage 读写 last-active、其它方法返回安全 no-op 值
- `MobileConnectPage`：纯结构测试，验证两个入口按钮 + handleConnect 调用 localStorage + store

---

## Self-Review 检查项

- **Spec 覆盖**：
  - design §2.1（router 共用）→ W-C1
  - §2.2（App.tsx 共用 + kind 分支）→ W-C2
  - §2.3（app-store 共用 + WebHostBridge 实现 project）→ W-A1
  - §2.4（ProjectScope 不改）→ 不涉及
  - §2.5（扫码 + 连接）→ W-B1
  - §2.6（MobileLayout 极简）→ W-D1
  - §2.7-2.8（WS / 列表刷新）→ PR4a 不实现
- **回归风险**：
  - 桌面端行为 100% 不变（所有新分支都在 `kind === "web"` 下）
  - `HostBridge` 接口扩展是 optional 方法，desktop 端不实现时 `bridge.renderConnectPage?.()` / `renderMobileLayout?.()` 返回 undefined，走 fallback
- **反向依赖**：app → web 的反向依赖通过 HostBridge 注入避免（W-C1 / W-C2 的核心约束）
- **未覆盖项**：PR4b 的 UI 打磨、PWA 配置、iOS 兼容性明确不在本计划
