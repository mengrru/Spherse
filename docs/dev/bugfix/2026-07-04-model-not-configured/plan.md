# [Bugfix] 用户未配置/未选择模型时的连接死循环与错误展示 — 实施计划

> **For agentic workers:** 适合 subagent-driven-development 模式逐 task 实现。Steps 用 checkbox（`- [ ]`）跟踪。每个 Task 结束后必须运行对应 workspace 的 build + test 验证。

**Design doc:** `docs/dev/bugfix/2026-07-04-model-not-configured/design.md`

**核心思路:** 把模型解析从「连接建立阶段」延迟到「sendMessage 阶段」，session 在无模型状态下可存活；WS close code 语义化阻断重连死循环；error 事件加 `code` 字段实现 i18n 友好的错误展示。

**关键约定（实现时必须遵守）:**

- `resolveEffectiveModelId` 用 `||`（非 `??`），空串视为未配置
- `AgentOptions.initialState` 是 `Partial`，`model` 可选；`agent.state.model` 是可写属性（见 `pi-agent-core/dist/agent.d.ts`），缺模型时不传 model 即可构造 Agent
- `CHAT_CLOSE_CODES` 与 `ErrorEventCode` 统一从 `@spherse/server/contracts` 导出，前端引用，**不在前端硬编码**
- error 事件的 `code` 字段为 `Type.Optional`，保证无 code 的旧消息向后兼容
- reducer（`chat-session-reducer.ts`）是纯函数，**不调用** `useI18n`；i18n 翻译只在视图层（`ErrorMessageSection`）完成
- 老项目 `project.yaml` 残留的 `defaultModel` 字段自然忽略（YAML.parse 不拒绝额外字段），**不写迁移代码**

---

### Task 1: Core 层 — 移除 project-level defaultModel + 模型解析延迟

> 基础层，无依赖。改动 `errors.ts` / `types.ts` / `store/project.ts` / `factory.ts` / `session-runtime.ts` + core 测试。**阻塞** Task 2（server 需 `ModelNotConfiguredError`）。

**Files:**
- Modify: `packages/core/src/errors.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/store/project.ts`
- Modify: `packages/core/src/factory.ts`
- Modify: `packages/core/src/session-runtime.ts`
- Modify: `packages/core/src/__tests__/session-runtime.test.ts`
- Modify: `packages/core/src/__tests__/store/project.test.ts`
- Modify: `packages/core/src/__tests__/store/project-config.test.ts`

- [ ] **Step 1: 新增 `ModelNotConfiguredError`**

  `packages/core/src/errors.ts`：在末尾新增（沿用现有 Error 子类风格，带 `name` 赋值）：
  ```ts
  export class ModelNotConfiguredError extends Error {
    constructor() {
      super("Model is not configured. Please select a model in Settings.");
      this.name = "ModelNotConfiguredError";
    }
  }
  ```
  确认从 `packages/core/src/index.ts`（barrel）导出，供 server 引用。

- [ ] **Step 2: 从 `ProjectConfig` 删除 `defaultModel` 字段**

  `packages/core/src/types.ts:7`：删除 `defaultModel: string;` 这一行。`ModelGroupSettings.defaultModel`（`:79`）**保留不动**（那是 settings 层的）。

- [ ] **Step 3: `ProjectStore.create` 签名变更**

  `packages/core/src/store/project.ts:61`：`async create(name: string, defaultModel: string)` → `async create(name: string)`。删除 `:71` write 对象里的 `defaultModel,` 行。

- [ ] **Step 4: `factory.ts` 删除 project-level defaultModel 兜底**

  `packages/core/src/factory.ts:30-33`：`projectStore.create(options?.projectName ?? dirName, options?.defaultModel ?? "gemini-2.5-pro")` → `projectStore.create(options?.projectName ?? dirName)`。
  `:42-46` `new SessionRuntime(projectStore, { defaultModel: options?.defaultModel, ... })` **保留** `defaultModel` options（这是 globalDefaultModel 来自 settings），不动。

- [ ] **Step 5: 新增 `resolveEffectiveModelId` 统一函数**

  `packages/core/src/session-runtime.ts`（文件顶部，class 外）：新增：
  ```ts
  function resolveEffectiveModelId(
    profile: AgentProfile,
    globalDefaultModel: string | undefined,
  ): string | undefined {
    return profile.model || globalDefaultModel || undefined;
  }
  ```
  用 `||`，空串视为未配置。

- [ ] **Step 6: `buildAgent` 容忍缺模型**

  `packages/core/src/session-runtime.ts:216-218`：
  - 替换 `const modelId = profile.model ?? this.globalDefaultModel ?? config.defaultModel;`
    为 `const modelId = resolveEffectiveModelId(profile, this.globalDefaultModel);`
  - 替换 `const model = resolveModelById(modelId);` 为惰性解析：
    ```ts
    let model: ReturnType<typeof resolveModelById> | undefined;
    if (modelId) {
      try {
        model = resolveModelById(modelId);
      } catch (err) {
        this.logger.warn({ err, modelId, agentId: profile.id }, "model not resolvable, agent will wait for model config");
      }
    }
    ```
  - `new Agent({ initialState: { systemPrompt, model, ... } })`：`model` 现在可能是 `undefined`，`initialState` 是 `Partial`，直接传即可（`undefined` 会被忽略）。

- [ ] **Step 7: 新增 `ensureModelForAgent` + `sendMessage` 守卫**

  `packages/core/src/session-runtime.ts`：在 class 内（`sendMessage` 上方）新增 private 方法：
  ```ts
  private ensureModelForAgent(agent: Agent, agentId: string): void {
    const profile = this.projectStore.getAgent(agentId)?.getProfile();
    if (!profile) throw new NotFoundError(`Agent "${agentId}" not found`);
    const modelId = resolveEffectiveModelId(profile, this.globalDefaultModel);
    if (!modelId) throw new ModelNotConfiguredError();
    try {
      agent.state.model = resolveModelById(modelId);
    } catch {
      throw new ModelNotConfiguredError();
    }
  }
  ```
  `sendMessage`（`:110`）：在 `const { agent, agentId } = entry;` 之后、`const unsubscribe = ...` 之前，插入 `this.ensureModelForAgent(agent, agentId);`。
  顶部 import 补 `ModelNotConfiguredError`（来自 `./errors.js`）。

- [ ] **Step 8: `syncActiveAgentsModel` 改用统一函数**

  `packages/core/src/session-runtime.ts:62`：`const modelId = profile.model ?? this.globalDefaultModel ?? config.defaultModel;` → `const modelId = resolveEffectiveModelId(profile, this.globalDefaultModel);`。移除对 `config` 的引用（若 `const config = this.projectStore.config.get();` 在本方法内不再被使用则一并删除该行；注意 `buildAgent` 仍需 `config`）。

- [ ] **Step 9: 更新 core 测试**

  `packages/core/src/__tests__/session-runtime.test.ts`：
  - 新增：`buildAgent` 无模型（globalDefaultModel 为 undefined 或空串）时不抛错，Agent 构造成功
  - 新增：`sendMessage` 无模型时抛 `ModelNotConfiguredError`；配置模型（mock `setDefaultModel`）后 `sendMessage` 不再抛该错
  - 新增：`resolveEffectiveModelId` 空串视为未配置（若该函数被导出则直接测，否则通过 buildAgent/sendMessage 间接覆盖）
  - 更新现有涉及 `defaultModel` 的 mock（`setDefaultModel` mock 保留，但 `config.defaultModel` 相关断言移除）
  - **注意**：现有 `createProject(tmpDir, { temperature: 0.3 })` 不传 `defaultModel`，改造后 buildAgent 不再调用 `resolveModelByIdMock`（无模型时不解析）。涉及 `resolveModelByIdMock` 调用次数断言的用例需相应调整（要么在 options 里传 `defaultModel` 让它有模型，要么改为断言「无模型时不调用」）。`FakeAgent.state.model` 当前是必选对象，需改为可选以反映新语义。

  `packages/core/src/__tests__/store/project.test.ts`：
  - 移除 `expect(config.defaultModel).toBe(...)` 断言
  - `projectStore.create(...)` 调用去掉第二个参数

  `packages/core/src/__tests__/store/project-config.test.ts`：
  - fixture 里移除 `defaultModel` 字段；新增一个用例：读取含 `defaultModel` 的老 YAML 时不报错、且 `config.defaultModel` 为 undefined（验证老字段忽略）

- [ ] **Step 10: 验证**

  ```bash
  npm run build --workspace=packages/core
  npm test --workspace=packages/core
  ```
  build 通过、测试全绿。

---

### Task 2: Server 层 — close code 语义化 + error 事件 code 字段

> 依赖 Task 1（`ModelNotConfiguredError`）。改动 `contracts/websocket.ts` / `ws-chat.ts` + server 测试。**阻塞** Task 3（app 需 `CHAT_CLOSE_CODES` / `ErrorEventCode` 导出）。

**Files:**
- Modify: `packages/server/src/contracts/websocket.ts`
- Modify: `packages/server/src/ws-chat.ts`
- Modify: `packages/server/src/__tests__/contracts/api-contracts.test.ts`
- Modify: `packages/server/src/__tests__/ws-chat.test.ts`（若无则新增）

- [ ] **Step 1: contracts 新增 `ErrorEventCode` enum + error 事件 `code` 字段**

  `packages/server/src/contracts/websocket.ts`：
  - 文件顶部新增 enum：
    ```ts
    export enum ErrorEventCode {
      ModelNotConfigured = "MODEL_NOT_CONFIGURED",
    }
    ```
  - `chatServerEvent` 的 error 分支改为：
    ```ts
    Type.Object({
      type: Type.Literal("error"),
      message: Type.String(),
      code: Type.Optional(Type.Enum(ErrorEventCode)),
    }),
    ```
  - 确认 `index.ts` barrel 导出 `ErrorEventCode`。

- [ ] **Step 2: contracts 新增 `CHAT_CLOSE_CODES` 常量**

  `packages/server/src/contracts/websocket.ts`：新增并导出：
  ```ts
  export const CHAT_CLOSE_CODES = {
    SESSION_UNRECOVERABLE: 4401,
    MODEL_NOT_CONFIGURED: 4402,
  } as const;
  ```
  确认 barrel 导出。

- [ ] **Step 3: `ws-chat.ts` restoreSession catch 发致命 close code**

  `packages/server/src/ws-chat.ts:21-25`：
  - import `CHAT_CLOSE_CODES` 和 `NotFoundError`
  - catch 改为按错误类型决定 close code：
    ```ts
    ctx.sessionRuntime.restoreSession(agentId, sessionId).catch((err) => {
      const message = err instanceof Error ? err.message : "request failed";
      const code = err instanceof NotFoundError
        ? CHAT_CLOSE_CODES.SESSION_UNRECOVERABLE
        : 1000;
      socket.send(JSON.stringify(parseChatServerEvent({ type: "error", message })));
      socket.close(code, message);
    });
    ```

- [ ] **Step 4: `ws-chat.ts` sendMessage catch 附带 code**

  `packages/server/src/ws-chat.ts:47-53`：import `ModelNotConfiguredError`、`ErrorEventCode`。catch 改为：
  ```ts
  } catch (err) {
    fastify.log.error({ err, sessionId }, "chat ws message error");
    const message = err instanceof Error ? err.message : "chat error";
    const code = err instanceof ModelNotConfiguredError
      ? ErrorEventCode.ModelNotConfigured
      : undefined;
    socket.send(JSON.stringify(parseChatServerEvent(
      code ? { type: "error", message, code } : { type: "error", message },
    )));
  }
  ```

- [ ] **Step 5: 更新 contracts 测试**

  `packages/server/src/__tests__/contracts/api-contracts.test.ts`：
  - 现有 `parseChatServerEvent({ type: "error", message: "boom" })` 用例保留（验证向后兼容）
  - 新增：`parseChatServerEvent({ type: "error", message: "x", code: "MODEL_NOT_CONFIGURED" })` 正确 parse 出 `code`
  - 新增：`code` 为非法值时 parse 抛错（schema 校验）

- [ ] **Step 6: 新增/更新 ws-chat 测试**

  若 `packages/server/src/__tests__/ws-chat.test.ts` 不存在则新增。覆盖：
  - `restoreSession` reject `NotFoundError` 时 socket 收到 `close(4401)`
  - `restoreSession` reject 普通 Error 时 socket 收到 `close(1000)`
  - `sendMessage` 抛 `ModelNotConfiguredError` 时 socket 收到 `{type:"error", code:"MODEL_NOT_CONFIGURED"}` 且**不关闭连接**

  > 若 ws-chat 难以单元测试（依赖 fastify websocket），可降级为对 `CHAT_CLOSE_CODES` 常量值的断言 + 在 Task 3 的 streaming-store 测试中间接验证 close code 行为。

- [ ] **Step 7: 验证**

  ```bash
  npm run build --workspace=packages/server
  npm test --workspace=packages/server
  ```

---

### Task 3: App 层 + i18n — 阻断重连 + i18n 错误渲染

> 依赖 Task 2（`CHAT_CLOSE_CODES` / `ErrorEventCode` 导出）。改动 `streaming-store.ts` / `chat-session-reducer.ts` / `types.ts` / `ErrorMessageSection.tsx` + 3 个 locale 文件 + app 测试。最后一个 Task。

**Files:**
- Modify: `packages/app/src/features/chat/streaming-store.ts`
- Modify: `packages/app/src/features/chat/types.ts`
- Modify: `packages/app/src/features/chat/chat-session-reducer.ts`
- Modify: `packages/app/src/features/chat/ErrorMessageSection.tsx`
- Modify: `packages/i18n/src/locales/zh-CN.ts`
- Modify: `packages/i18n/src/locales/zh-TW.ts`
- Modify: `packages/i18n/src/locales/en.ts`
- Modify: `packages/app/src/features/chat/streaming-store.test.ts`
- Modify: `packages/app/src/features/chat/chat-session-reducer.test.ts`（若无则新增）

- [ ] **Step 1: i18n 新增文案**

  三个 locale 文件各加一条 key `chat.error.modelNotConfigured`：
  - `zh-CN.ts`：`"chat.error.modelNotConfigured": "尚未配置模型，请在设置中选择一个模型后再发送消息。"`（带场景注释：用户未配置模型时尝试发消息，聊天区显示的错误提示）
  - `zh-TW.ts`：`"chat.error.modelNotConfigured": "尚未設定模型，請在設定中選擇一個模型後再傳送訊息。"`
  - `en.ts`：`"chat.error.modelNotConfigured": "No model configured. Please select a model in Settings before sending messages."`

  运行 `npm run build --workspace=packages/i18n` 确认 catalog 类型校验通过（zh-CN 为基准，其它必须对齐 key）。

- [ ] **Step 2: `ChatMessage` 新增 `_errorCode` 字段**

  `packages/app/src/features/chat/types.ts`：在 `ChatMessage` 接口新增 `_errorCode?: import("@spherse/server/contracts").ErrorEventCode;`（用 inline import 或在文件顶部 import `ErrorEventCode` type）。

- [ ] **Step 3: reducer 透传 code**

  `packages/app/src/features/chat/chat-session-reducer.ts`：
  - 顶部 import `ErrorEventCode`（type）from `@spherse/server/contracts`
  - `appendErrorMessage`（`:38`）签名加 `code?: ErrorEventCode` 参数；返回的 ChatMessage 附带 `_errorCode: code`
  - `applyEventToMessages`（`:181`）error 分支：`return appendErrorMessage(prev, event.message, event.code);`
  - **不做翻译**，只透传结构化字段

- [ ] **Step 4: `ErrorMessageSection` 按 code 渲染 i18n**

  `packages/app/src/features/chat/ErrorMessageSection.tsx`：
  - props 新增可选 `errorCode?: ErrorEventCode`
  - 用 `useI18n()` 的 `t`，当 `errorCode === ErrorEventCode.ModelNotConfigured` 时展示文案用 `t("chat.error.modelNotConfigured")`，否则用原 `error`

  `packages/app/src/features/chat/MessageItem.tsx:53`（**唯一调用方**）：
  - `<ErrorMessageSection error={message._error} />` → `<ErrorMessageSection error={message._error} errorCode={message._errorCode} />`

- [ ] **Step 5: streaming-store 致命 close code 阻断重连**

  `packages/app/src/features/chat/streaming-store.ts`：
  - 顶部 import `CHAT_CLOSE_CODES` from `@spherse/server/contracts`
  - 文件顶部（常量区，`:15` 附近）新增：
    ```ts
    const FATAL_CLOSE_CODES = new Set<number>([
      CHAT_CLOSE_CODES.SESSION_UNRECOVERABLE,
      CHAT_CLOSE_CODES.MODEL_NOT_CONFIGURED,
    ]);
    ```
  - `ws.onclose`（`:276`）签名改为 `(event: CloseEvent)`，在现有清理逻辑之后、`scheduleReconnect` 判断之前插入：
    ```ts
    if (FATAL_CLOSE_CODES.has(event.code)) {
      manuallyClosed.set(sessionId, true);
      return;
    }
    ```

- [ ] **Step 6: 更新 streaming-store 测试**

  `packages/app/src/features/chat/streaming-store.test.ts`：
  - 测试 mock 的 `close()`（`:45-49`）目前用 `{}` as CloseEvent，`event.code` 为 undefined。新增用例时需直接调用 `socket.onclose?.({ code: 4401 } as CloseEvent)` 模拟服务端致命关闭。
  - 新增：「致命 close code（4401）不触发重连」——attach+connect 后模拟 `onclose({code:4401})`，推进 timer，断言无新 WebSocket 实例
  - 新增：「非致命 close（code 1000 或 undefined）触发重连」——已有 `reconnects with backoff` 用例覆盖，确认仍通过
  - 新增：「致命 close 后已加载 messages 保留」——先加载 history，再触发致命 close，断言 `sessions[id].messages` 非空

- [ ] **Step 7: 新增/更新 reducer 测试**

  `packages/app/src/features/chat/chat-session-reducer.test.ts`（若无则新建）：
  - 新增：error 事件带 `code: "MODEL_NOT_CONFIGURED"` 时，reducer 产出的 message 携带 `_errorCode: "MODEL_NOT_CONFIGURED"`
  - 新增：error 事件无 code 时，`_errorCode` 为 undefined（向后兼容）

- [ ] **Step 8: 验证**

  ```bash
  npm run build --workspace=packages/i18n
  npm run build --workspace=packages/app
  npm test --workspace=packages/i18n
  npm test --workspace=packages/app
  npm run lint
  ```
  build 通过、测试全绿、lint 无错。

---

## Task 依赖与并行性

```
Task 1 (core) ──► Task 2 (server) ──► Task 3 (app + i18n)
```

- **严格顺序**：Task 2 依赖 Task 1 的 `ModelNotConfiguredError`；Task 3 依赖 Task 2 的 contracts 导出。
- 每个 Task 完成后独立验证（build + test），失败则回到该 Task 修复，不污染下游。
- i18n 文案（Task 3 Step 1）与 contracts（Task 2）无类型耦合，但为减少跨 Task 上下文切换，统一放 Task 3。

## 全局验证（所有 Task 完成后）

```bash
npm run build                              # 全仓库编译
npm run verify                             # lint + build + unit tests + i18n check
```

可选（若改动涉及 Electron 启动 / ws / chat / session）：
```bash
npm run test:e2e --workspace=packages/app -- e2e/<相关 spec>
```
