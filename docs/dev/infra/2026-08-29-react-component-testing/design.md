# [Infra] packages/app 引入 React DOM 组件测试工具链

## 背景

packages/app 的测试层级现状存在明显断层：

| 层级 | 形式 | 数量 | 状态 |
|---|---|---|---|
| 纯逻辑单测 | `.test.ts`（stores/queries/lib/hooks 逻辑） | 110 | 运行良好 |
| 手写组件 DOM 测试 | `.test.tsx`，`createRoot` + `act` + `querySelector` 全手写 | 16（14 个含手写样板） | 可用但样板重、查询脆 |
| 源码结构断言 | `.structure.test.ts`，`readFileSync` 读源码做字符串/正则断言 | 38 | 脆弱，与实现细节耦合 |
| Playwright E2E | desktop 包，真实 Electron 环境 | 18 specs | 反馈环慢 |

具体痛点：

1. **基建是半成品**：`vitest.config.ts` 已配 jsdom + setup（ACT 环境、localStorage/matchMedia stub），但没有组件测试查询/交互层。手写测试中反复出现 native setter hack 模拟输入（`Composer.test.tsx` 的 `type()` 用 `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set`）、用 `svg.lucide-send` 图标类名定位按钮（图标库一升级就挂）、每文件 ~30 行 mount/unmount 样板。
2. **structure test 大量「测试债」**：对 38 个文件的逐条盘点结论——3 个文件（4 it）与既有行为测试完全重复或纯实现细节复读；26 个文件（192 it）断言的实际是运行时行为（禁用态、降级路径、防重入、条件渲染），本该用渲染测试表达；仅 9 个文件（24 it）是真架构不变量（跨文件完整性、层边界负断言）。源码字符串断言的问题：重命名变量会假挂、改坏行为可能不挂。
3. **@base-ui/react 无头组件**（`components/ui` 下 21 个 primitive import `@base-ui`，被 features 广泛间接使用）的 ARIA 状态（`aria-expanded` 等）缺少合适的测试层：E2E 太慢太脆，手写 DOM 测试查询原语不足。
4. **仓库有版本先例但无深度先例**：packages/i18n 已用 `@testing-library/react` 16.3（React 19 兼容，仅 `renderHook`）；render/cleanup/user-event/jest-dom 组合在本仓库无先例，需 Phase 1 试点验证。

## 目标

- packages/app 具备 Testing Library 组件测试能力：渲染、语义查询（role/label/ARIA 状态）、用户交互（typing/click/keyboard）
- structure test 收敛到「真架构不变量」：38 → 9 个文件，其余删除；lint 性质的断言规则化进 ESLint
- 删除的 behavior 类 structure 断言中确有行为价值的部分，以 TL 行为测试补回（不 1:1 迁移，按行为价值取舍）
- 14 个手写 `createRoot` DOM 测试迁移到 TL，消除样板与脆弱查询
- 建立组件测试规范，杜绝新增手写样板与实现细节断言

## 非目标

- 不替换 jsdom 为 happy-dom：jsdom 已就绪且与 i18n 一致，换环境引入行为差异风险无收益
- 不替代 Playwright E2E：布局/CSS/主题/启动链/Electron 集成仍归 E2E；TL 只测交互逻辑与 ARIA
- 不迁移 packages/web、packages/landing（后者无测试基建，等有组件测试需求时再议）
- 不追求 192 个可迁移 it 的等量补写：实现细节断言（className 字符串、函数名、源码模式、调用顺序）直接丢弃是预期收益
- 不为迁移而改运行时代码；若组件「不可测」是因为缺少可访问性语义（无可达 label），按测试暴露的问题顺带修，单独列出

## 方案

### 1. 依赖与配置

`packages/app` devDependencies 新增：

```
@testing-library/react@^16.3.2     # 与 packages/i18n 同版本，React 19 兼容
@testing-library/user-event@^14.6
@testing-library/jest-dom@^6.6
```

`vitest.setup.ts` 新增两处：

```ts
import "@testing-library/jest-dom/vitest"; // 扩展 vitest expect 类型与 matchers
import { cleanup } from "@testing-library/react";

// vitest 未开 globals: true，RTL 检测不到全局 afterEach，auto-cleanup 不生效
afterEach(() => {
  cleanup();
});
```

`afterEach` 从 vitest 显式 import（与现有 `vi` import 同来源）。

### 2. 共享测试工具 `src/test/`

现状 16 个 `.test.tsx` 中 14 个手写 `createRoot` 样板，其中 5 个还需各自手搭 Provider（`ProjectProvider` / `MemoryRouter` / `QueryClientProvider`），mock host bridge 的工厂散落在多个文件。新增：

```
src/test/
├── render.tsx        # renderWithProviders + createTestQueryClient
└── host-bridge.ts    # createMockHostBridge(overrides)
```

- `renderWithProviders(ui, { projectId?, projectRoot?, route?, queryClient?, wrapper? })`：默认包 `ProjectProvider`（缺省 `p1` / `/tmp/p1`）+ `MemoryRouter`；传入 `queryClient` 时加 `QueryClientProvider`；`wrapper` 允许追加自定义 Provider。返回 TL `render` 的全部返回值
- `createTestQueryClient()`：每测试新建、关闭 retry 与 gcTime 的 QueryClient（README 守则「Query 相关测试应每测试新建 QueryClient」的工具化）
- `createMockHostBridge(overrides)`：从 `TriggerEventBridge.test.tsx`、`UpdateNoticeBridge.test.tsx` 等现有 mock 提炼统一工厂，`Partial<HostBridge>` 覆盖

### 3. structure test 处置（38 文件分类清单）

| 处置 | 文件数 | it 数 | 动作 |
|---|---|---|---|
| A. 直接删除（重复/实现细节复读） | 3 | 4 | 删除 |
| B. 保留（真架构不变量） | 9 | 24 | 保留；其中 SidePanel 4 个行为 it 随 Phase 3 迁出（净保留 20 it） |
| C. 删除 + 补写行为测试 | 26 | 192 | 删除；按域补核心行为 TL 测试 |

**A. 直接删除（3）**：

- `components/markdown-content/CodeBlock.structure.test.ts` — 已被 `CodeBlock.test.tsx` 逐条覆盖
- `components/ui/combobox.structure.test.ts` — Tailwind class 字符串复读（`h-7`/`shrink-0`）
- `ui-sdk/UiSdkBridge.structure.test.ts` — hook 名清单复读；挂载完整性已由 `ProjectRuntimeBridges.structure.test.ts` 承担，SDK 逻辑已有 15+ 行为测试

**B. 保留（9，架构不变量）**：

- `layouts/project-lifecycle.structure.test.ts` — 全 src 扫描：所有定义 `clearProject` 的 store 必须进 `closeProjectCascade` 清单（价值最高）
- `App.structure.test.ts` — App shell 层边界负断言
- `lib/host-capabilities.structure.test.ts` — 接口白名单 + 全 src 消费面双向校验
- `layouts/ProjectRuntimeBridges.structure.test.ts` — bridge 挂载完整性清单
- `layouts/ProjectScope.structure.test.ts` — 职责下放负断言（与上条配对）
- `features/project-panel/ProjectPanel.structure.test.ts` — 滑动职责归属
- `features/activity-bar/ActivityBar.structure.test.tsx` — feature-root 自治契约
- `features/side-panel/SidePanel.structure.test.ts` — 保留其中架构 its（单一滑动单元、唯一 transform）；行为 its（mobile 分支、inert、导航后关闭，共 4 it）随 Phase 3 迁出为 TL 测试
- `features/floating-chat/FloatingChatContainer.structure.test.ts` — `<Chat key={sessionId}>` remount 会话隔离守卫（行为等价测试需拉起完整 Chat 栈，成本过高）

**C. 删除 + 补写（26，按域分批）**：

| 域 | 文件 | it | 补测重点 | 补测批次 |
|---|---|---|---|---|
| settings | use-settings-form / CustomProviderDialog / UpdateChecker / AdvancedSettings / ModelProviderItem / ThinkingLevelField | 84 | use-settings-form 用 `renderHook` 测数据流接线（init 读取、save payload 分组、customProviders CRUD 副作用、断连保留 sampling、catalog 刷新）；其余 5 个用 TL 测表单行为（校验、编辑回填、禁用态、blur 提交、reset） | 本期 |
| chat | save-export-degradation / Composer / ErrorMessageSection / MessageItem / TriggerTurnGroup / HtmlCard / Header | 32 | web 降级路径（最脆的源码顺序断言）、附件管线状态机、errorCode 分支、撤回入口条件、portal 归属 | 本期 |
| content-browser | UnsupportedFileCard / ContentView | 14 | capability 门控、findEnabled 开关与受控态 | 本期 |
| onboarding | OnboardingPage | 10 | 防重入（**提升到本期补写**）、manifest 加载、错误 toast、成功导航 | 文件本期删，防重入补测本期，其余下期 |
| welcome-page | WelcomePage | 11 | 降级 fallback、防抖、key 强刷（**防抖与 key 强刷提升到本期补写**） | 文件本期删，高价值补测本期，其余下期 |
| skill-panel | MarketplaceDialog / SkillPanel | 13 | 打开时失效、安装/409 态、bridge 调用 | 下期 |
| agent-trigger | TriggerFeature | 11 | 三模式渲染、日志倒序（部分 its 与 TriggerEventBridge 重复，删） | 下期 |
| hooks | useBusSubscription | 4 | renderHook 验证 handler 变更不重订阅 | 下期 |
| 其他 | AgentDialog / DebugTools / MarkdownContent / AgentRow / sonner | 13 | 薄组件渲染断言，机械迁移 | 下期 |

补写取舍原则（写入 README 规范）：

- **补**：用户可感知行为——禁用态、条件渲染、降级路径、防重入、数据流、toast、ARIA 状态
- **丢**：实现细节——className/图标类名字符串、函数与 hook 名、源码模式、执行顺序
- 已有行为测试覆盖的（CodeBlock、Composer 部分 its、marketplace-state、turn-groups、update-checker hook 层）直接删，不重写

### 4. lint 性质断言 ESLint 化

约 8 个 structure 文件末尾挂着相同模式的「semantic tokens / no hardcoded colors / no dark:」it（合计 12 it），本质是 lint 规则的测试化。规则化到 `eslint.config.js`：

- `no-restricted-syntax` 匹配 JSXAttribute `className` 的 Literal/TemplateLiteral 值含 `dark:` → error；范围 **排除 `components/ui/**`**（shadcn 风格 primitive 的 `dark:` 是 design system 允许的样式层，features/layouts/pages 现状已干净），即作用于 `packages/app/src/{features,layouts,pages,components/markdown-content}/**/*.tsx`
- 同 selector 匹配硬编码颜色（`#hex`、`rgb(`/`rgba(`、Tailwind 任意色值 class 如 `text-[#...]`）→ error

局限：`cn()` 调用参数中的动态拼接不强行覆盖（AST 可查 literal 参数，一期先覆盖 JSXAttribute 与 `cn()` 字面量参数，features 全量覆盖，宽于被删 8 文件的实际覆盖面）；`.ts` 文件中的 class 字符串暂不覆盖，与被删测试现状持平。

### 5. 手写 DOM 测试迁移（14 个 `.test.tsx`）

机械替换，不改测试语义：

| 手写模式 | TL 替代 |
|---|---|
| `host` div + `createRoot` + `act(() => root.render())` | `renderWithProviders()` |
| `afterEach` 手动 `root.unmount()` | setup 中全局 `cleanup()` |
| `host.querySelector("textarea")` | `screen.getByRole("textbox")` |
| `svg.lucide-send` 图标类名查询 | `getByRole("button", { name })`（依赖可访问名） |
| native setter hack + `dispatchEvent(input)` | `userEvent.type()` |
| `new KeyboardEvent` + dispatch | `userEvent.keyboard()` |
| `root.render()` 二次调用 | `rerender()` |

注意事项：

- fake timers 场景（WithdrawButton）：`userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`
- base-ui 组件在 jsdom 下依赖 focus/pointer 特性时，优先 `userEvent`，不生效再降级 `fireEvent`，个别需要 stub（`Element.prototype.scrollIntoView` 等），统一放 `src/test/jsdom-stubs.ts`

### 6. 新增测试红线（写入 packages/app/README.md「测试与验证」）

1. 新组件/hook 测试一律 Testing Library（`render`/`renderHook`/`screen`/`userEvent`），禁止新增 `createRoot` 手写样板
2. `.structure.test` 仅允许架构不变量（全 src 扫描、跨文件完整性、层边界负断言），禁止断言单文件实现细节
3. 查询优先级：`getByRole` / `getByLabelText` / `getByDisplayValue`；`data-testid` 仅在无语义属性可用时使用；禁止图标类名查询
4. Provider 搭建一律走 `src/test/` 工具；host bridge mock 一律走 `createMockHostBridge`

## 迁移计划

| 阶段 | 内容 | 交付物 |
|---|---|---|
| Phase 1 基建 | 依赖 + setup + `src/test/` 工具 + ESLint 规则；试点迁移 `WithdrawButton`（fake timers 样板）与 `Composer`（typing 样板）。试点验收：cleanup 无跨测试 DOM 泄漏、userEvent 在 fake timers 下按 `advanceTimers` 配置工作、jest-dom matchers 类型与行为正常 | 组件测试可写、可跑、可 lint |
| Phase 2 清理 | 删除 3 个 A 类 + 26 个 C 类 structure 文件；删除 commit 附全部被删 it 的逐条清单归档（追加到本文档附录，backlog 条目链接之）；补写本期范围核心行为测试：settings / chat / content-browser 三域全量 + onboarding 防重入 + welcome 防抖与 key 强刷（预计 45–65 条） | structure test 收敛至 9 文件 |
| Phase 3 收尾 | 迁移其余 12 个手写 `.test.tsx` 与 SidePanel 4 个行为 it；下期域（skill-panel/onboarding 其余/welcome 其余/trigger/hooks/其他）按归档清单补测 | 手写样板清零 |

- Phase 1 + 2 为本次变更范围（一个分支，可分 2–3 个 commit：基建 / 删除+补测 / README 与文档）
- Phase 3 随后独立推进，未消化的补测项进 backlog，按 touch 原则处理；删除文件后新增断言禁止再写入 structure 文件
- 每阶段跑 `npm test --workspace=packages/app` + `npm run lint`，收尾跑 `npm run verify`（纯测试变更，不触运行时，不需要 E2E）

## 风险与对策

1. **RTL auto-cleanup 失效**（vitest 未开 globals）：setup 显式 `afterEach(cleanup)`，Phase 1 试点验证无跨测试 DOM 泄漏。**试点发现的两个补充事实**：(a) vitest 4 的 fake timers 与 userEvent 并存需 `vi.useFakeTimers({ shouldAdvanceTime: true })`，否则 userEvent 内部调度永不触发、测试超时；(b) vitest 的 afterEach 按注册逆序执行，setup 级 cleanup 在测试文件 afterEach **之后**运行——组件卸载副作用（如 Composer 卸载时把草稿写回 localStorage）会污染下一个测试，此类测试需在自身 afterEach 里先显式 `cleanup()` 再清 storage。
2. **base-ui 在 jsdom 的兼容性**：floating-ui 定位类组件 `getBoundingClientRect` 全 0，不影响 open 状态断言；focus/pointer 依赖按需 stub 或 `fireEvent` 兜底，沉淀进 `src/test/jsdom-stubs.ts`。
3. **删除 structure 测试的覆盖缺口**：下期域的高价值断言（onboarding 防重入、welcome 防抖/key 强刷）已提升到本期补写；其余实现细节断言丢失是目标而非风险；全部被删 it 以归档清单附录在案，Phase 3 按单补写。
4. **jest-dom 与 vitest 4 兼容**：jest-dom ≥6.6 提供 `/vitest` 入口，试点阶段先验证 matchers 类型与行为。
5. **补测引入的 mock 漂移**：mock 统一收敛 `createMockHostBridge` / `createTestQueryClient`，避免各文件自定义 mock 与真实契约脱钩（契约本身仍由 server 包契约测试守卫）。

## 验证

```bash
npm test --workspace=packages/app     # 全量单测（含新增 TL 测试）
npm run lint                          # 含新增 no-restricted-syntax 规则
npm run verify                        # lint + build + typecheck + test 全链
```

## 文档同步

- `packages/app/README.md`：「测试与验证」节写入红线与工具用法
- `docs/official/project-structure.md`：packages/app 新增 `src/test/` 目录
- `docs/dev/backlog.md`：Phase 3 遗留补测条目

## 附录：Phase 2 删除的 structure 断言清单

Phase 3 按单补写时以此为准；标注「已补」的条目已在本期以 TL 行为测试覆盖。

```
=== components/markdown-content/CodeBlock.structure.test.ts 【已补：CodeBlock.test.tsx 覆盖，直接删】
- keeps the data-md-code theme hook on the inner pre, not the wrapper div
- guards against a missing navigator.clipboard before writing
=== components/ui/combobox.structure.test.ts 【不补：Tailwind class 复读】
- keeps the input at fixed height when the popup content overflows
=== ui-sdk/UiSdkBridge.structure.test.ts 【不补：hook 名清单复读，挂载清单由 ProjectRuntimeBridges.structure 覆盖】
- owns UI SDK project integration
=== features/settings/use-settings-form.structure.test.ts 【已补：use-settings-form.test.tsx renderHook】
- reads text sampling from settings on init
- includes sampling in the text group of the save payload
- omits sampling from the image group of the save payload
- exposes a single patchSampling (no setTemperature/resetTemperature/setTopP/resetTopP)
- persists sampling immediately via mergeSampling + save
- preserves sampling (via spread of data) when disconnecting a provider
- does not read image sampling from settings on init
- reads text thinkingLevel from settings on init
- includes thinkingLevel in the text group of the save payload
- omits thinkingLevel from the image group of the save payload
- exposes changeThinkingLevel and persists immediately
- does not read image thinkingLevel from settings on init
- exposes commitApiKey on the group form state
- commitApiKey persists the key by saving the updated apiKeys (not only local state)
- reads customProviders from settings on init
- includes customProviders in the save payload
- accepts a customProvidersOverride param on save
- exposes customProviders and the three mutation methods on the text group
- addCustomProvider generates an id and refreshes the catalog on success
- refreshTextCatalog refetches supported providers
- updateCustomProvider keeps the id stable
- removeCustomProvider clears apiKey and defaultModel referencing the provider
- does not expose custom provider methods on the image group
=== features/settings/CustomProviderDialog.structure.test.ts 【已补：CustomProviderDialog.test.tsx】
- reinitializes form fields when the dialog opens (effect keyed on open)
- switches title between add/edit based on initial
- parses model ids by splitting on comma and newline, trimming, dropping empties, deduping
- validates baseUrl via new URL and http(s) protocol check
- disables Save while validation fails and renders Cancel outline
- assembles the def preserving initial.id in edit mode / empty id in add mode
【不补：prop 接口/import 来源/Dialog 模式/控件选型/i18n key 清单/颜色 token 类断言（ESLint 化）】
=== features/settings/UpdateChecker.structure.test.ts 【已补：UpdateChecker.test.tsx】
- renders status-based buttons (idle/checking/upToDate/error/downloading)
- wires the check button to check()
- renders a progress bar for the downloading state
- wires cancelDownload on the cancel button
- renders an update-available dialog bound to status === available
- supports both manual download (openExternal) and auto download (acceptDownload)
- renders a downloaded dialog with restart actions
【不补：使用哪个 hook/window.electronAPI 负断言/i18n key 清单/颜色 token】
=== features/settings/AdvancedSettings.structure.test.ts 【已补：AdvancedSettings.test.tsx】
- is collapsed by default
- commits on blur via config.parse (not on every keystroke)
- resets a field via onSet(undefined) rather than a dedicated onReset prop
- constrains topP to 0–1 (max: 1) while temperature has no max
【不补：primitive 选型/props 形状/tooltip 位置/图标旋转/i18n/颜色 token】
=== features/settings/ModelProviderItem.structure.test.ts 【已补：ModelProviderItem.test.tsx】
- custom row renders the Custom badge + baseUrl subtitle
- custom row renders edit/delete icon buttons wired to onEdit/onDelete
- hides edit/delete buttons when their callbacks are undefined
- keyless row renders the keyless badge and omits the api-key input + connect/disconnect
- keeps the built-in api-key input + connect/disconnect behavior for keyed rows
- persists the api key on blur via onApiKeyCommit
【不补：props 类型/lucide import 风格/颜色 token】
=== features/settings/ThinkingLevelField.structure.test.ts 【已补：ThinkingLevelField.test.tsx】
- renders a NativeSelect with the four generic levels
- defaults the select value to medium when undefined
【不补：tooltip/i18n key/props 类型/颜色 token】
=== features/chat/save-export-degradation.structure.test.ts 【已补：save-export-degradation.test.tsx】
- HtmlCard falls back to saveBlob when showSaveDialog is unavailable
- ImageCard falls back to fetching the preview url and saving a blob
- BrowserPage redirects to the project home when the browser feature is disabled
=== features/chat/Composer.structure.test.ts 【已补：Composer.test.tsx（含附件管线）】
- passes an optional AttachedImage through onSend
- renders a hidden image file input triggered by the attach button
- swaps the attach button icon for the spinner while busy
- runs the compress -> upload pipeline and deletes on remove
- tracks an idle/compressing/uploading/error status and disables send while busy
- keeps the textarea editable while streaming and only disables it while loading
- surfaces attach failures via the i18n toast
=== features/chat/ErrorMessageSection.structure.test.ts 【已补：ErrorMessageSection.test.tsx】
- renders the i18n model-not-configured text when errorCode is ModelNotConfigured
- falls back to the raw error for other codes
- renders an open-settings button for Auth errors
【不补：prop 类型/import 来源/i18n hook/颜色 token】
=== features/chat/MessageItem.structure.test.ts 【已补：MessageItem.test.tsx】
- renders a withdraw action for user messages when onWithdraw is provided
- renders user message image attachments through the preview url
- opens chat bubble links via the shared link resolver instead of navigating in place
【不补：渲染顺序断言（源码顺序）/锚点链接/链接颜色/portal 细节（并入 HtmlCard/ImageCard 行为）】
=== features/chat/TriggerTurnGroup.structure.test.ts 【已补：TriggerTurnGroup.test.tsx】
- defaults to collapsed and renders messages only through CollapsibleContent
- shows the error badge only when the turn failed
【不补：data-chat-turn-collapse 属性（theme hook，随渲染断言顺带）/MessageList 分组接线（turn-groups.test.ts 已覆盖分组逻辑）】
=== features/chat/HtmlCard.structure.test.ts 【已补：HtmlCard 行为断言并入 save-export-degradation.test.tsx 与 HtmlCard.test.ts】
- renders the expanded overlay through a portal to document.body
=== features/chat/Header.structure.test.ts 【已补：随 Chat 渲染断言 data-chat-header；极薄，不单独建文件】
- exposes data-chat-header for agent theme CSS targeting
=== features/content-browser/UnsupportedFileCard.structure.test.ts 【已补：UnsupportedFileCard.test.tsx】
- gates the button on the openFileExternal capability
- opens the file via the project host api
- joins projectRoot + relative filePath into an absolute path
【不补：context 读取方式/i18n key/window.electronAPI 负断言/颜色 token】
=== features/content-browser/ContentView.structure.test.tsx 【已补：ContentView.test.tsx】
- binds Cmd/Ctrl+F to open the find bar when enabled
- accepts optional parent-controlled findOpen props with an internal fallback
- closes find when the view becomes non-searchable
【不补：findEnabled 覆盖面（列表枚举属实现细节）/FindBar props 形状/ref 合并】
=== features/onboarding/OnboardingPage.structure.test.ts 【防重入已补；其余下期】
- guards open-or-create and open-sample actions against rapid re-entry 【已补】
- loads the sample manifest once on mount via host bridge 【下期】
- renders two onboarding actions: the merged open-or-create card and the sample card 【下期】
- navigates to the opened project on success 【下期】
- surfaces errors via sonner toast keyed off the error code 【下期】
- catches unexpected rejections in both actions so failures are visible (not silent) 【下期】
【不补：自治性（架构类）/window.electronAPI/颜色 token】
=== features/welcome-page/WelcomePage.structure.test.ts 【防抖与 key 强刷已补；其余下期】
- debounces reload to coalesce rapid save bursts and clears prior load errors 【已补】
- uses a cache-stable preview URL and forces reload via React key on iframe/img 【已补】
- clears the debounce timer on unmount 【已补】
- renders the fallback when the query errors or resolves no path 【下期】
- only reloads when the changed path matches the current welcome page path 【下期】
- normalizes backslashes so windows paths compare equal 【下期】
- falls back to project root index.html in the query when no welcome page is configured 【下期】
【不补：query 接线/bus 订阅细节/失效归属 bridge（架构类）】
=== features/skill-panel/MarketplaceDialog.structure.test.ts 【下期补测】
- invalidates marketplace and local skill queries each time the dialog opens
- installs via the marketplace install client method and invalidates skill queries
- handles 409 manifest drift by toasting and invalidating marketplace queries
- renders loading, error with retry, and empty states
【不补：prop 接口/Dialog 模式/deriveSkillCardState（marketplace-state.test.ts 已覆盖）/loading 三态清单】
=== features/skill-panel/SkillPanel.structure.test.ts 【下期补测】
- renders the skills section with a create/install menu and a skills-rooted tree
- wires file selection and deletion to navigation like UserFilePanel
- installs via the host bridge instead of window.electronAPI
=== features/agent-trigger/TriggerFeature.structure.test.ts 【下期补测】
- renders the manual trigger button before the edit button
- places the create button in the config content area, coexisting with the list
- shows all three session modes in the expanded trigger profile
- shows trigger logs by reversing the API order
- shows completion timestamps for completed trigger logs
- includes trigger type selector in the form
- shows event-specific fields only for event type
【不补：websocket 归属（架构类）/toast（TriggerEventBridge.test.tsx 已覆盖）/空数组 fallback（微性能）/draft 契约（实现细节）】
=== hooks/useBusSubscription.structure.test.ts 【下期补测】
- holds the latest handler in a ref so handler changes do not re-subscribe
- registers the handler on mount and removes it on cleanup
- delegates dispatched events through the stable wrapper to the ref
【不补：依赖数组形状（ref 模式的目的即上一条）】
=== features/agent-dialog/AgentDialog.structure.test.ts 【下期补测】
- fills prompt directly when empty, confirms when non-empty
【不补：import 来源/Picker 位置/AlertDialog 选型】
=== features/debug-tools/DebugTools.structure.test.ts 【下期补测】
- reads isDev through the host bridge devTools api
- wires debug actions through bridge.devTools
【不补：window.electronAPI 负断言（被 bridge mock 行为隐式覆盖）】
=== components/markdown-content/MarkdownContent.structure.test.ts 【下期补测】
- exposes a linkClassName prop for context-specific link color overrides
- merges linkClassName after the text-primary baseline so twMerge lets it win
=== features/agent-session-list/AgentRow.structure.test.ts 【下期补测】
- uses CollapsibleTrigger so agent and file tree rows share expanded-state behavior（行为化：行点击展开 + chevron 状态）
=== components/ui/sonner.structure.test.ts 【已补：随 Toaster 渲染断言；极薄，并入相邻测试或单独渲染断言】
- exposes data-toast-root for project theme CSS targeting
```
