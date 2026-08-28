# 模型思考强度配置（一期：settings 全局默认）

## 背景

pi-agent-core / pi-ai 已提供完整 thinking 能力：`ThinkingLevel` 七档（off/minimal/low/medium/high/xhigh/max）、`SimpleStreamOptions.reasoning`、`getSupportedThinkingLevels(model)`，且各 provider adapter 自动 `clampThinkingLevel`（对不支持的档位/模型静默降级或忽略）。Spherse 唯一接入点是 `packages/core/src/session/agent-assembly.ts:226` 硬编码 `thinkingLevel: "medium"`，无任何配置入口。

与用户商定分两期：

- **一期（本文）**：settings → Models tab 增加全局默认思考强度，走 sampling 同款传播链路
- **二期（后续）**：composer 会话级快捷覆盖，按当前模型支持的档位动态显示

档位粒度：通用 4 档 `off / low / medium / high`（简化 UI；实际生效由 pi-ai 按模型 clamp）。

## 设计

### 类型与存储

- `packages/core/src/types.ts` 新增 `export type ThinkingLevel = "off" | "low" | "medium" | "high"`（pi-agent-core 七档的子集，结构兼容可直接赋值，不直接 re-export 以免 settings schema 依赖上游类型面）
- `ModelGroupSettings` 加 `thinkingLevel?: ThinkingLevel`（与 `sampling` 平级；应用点在 agent state 而非 streamFn，不塞进 SamplingParams）。仅 `models.text`，image 组不需要
- `undefined` 语义 = 默认 `medium`：现有 settings.json 无此字段，行为不变，无需迁移

### 传播链路（照抄 defaultModel/sampling 模式）

```
Settings UI (Models tab, 默认模型下方新字段)
→ use-settings-form (GroupFormState + save payload + changeThinkingLevel)
→ HostBridge.saveSettings → [desktop] ipc "save-settings"
   → electron/settings.ts (mergeModelGroup + maskModelGroup 均透传) + updateThinkingLevel
   → electron/server.ts (ensureServer 种子 + updateThinkingLevel)
   → server/src/index.ts MultiProjectServerOptions { thinkingLevel } → registry 构造透传
→ server registry.setThinkingLevel (字段 + fan-out 新旧 project)
→ core factory AssembleOptions / RunConfig { thinkingLevel? }
→ session-manager.setThinkingLevel (runConfigHolder.update + 活跃 session fan-out)
→ AgentRunner.applyThinkingLevel: this.agent.state.thinkingLevel = level (有变更才写)
```

`buildAgent` L226 改为 `thinkingLevel: deps.runConfig.current().thinkingLevel ?? "medium"`。

传播语义与 sampling 一致：无条件传播（含 undefined = 恢复 medium）。

### UI

- Models tab 默认模型下方加一档选择控件（4 项 + i18n 文案，`settings.models.thinkingLevel.*`），不放 AdvancedSettings：使用频率高于 temperature/topP，且非数值参数
- 控件无条件显示，helper 文案说明「仅对支持推理的模型生效，超出模型支持范围时自动就近调整」——不做按默认模型动态显隐：生效模型可能被 agent 的 `profile.model` 覆盖，全局值与实际模型的匹配交给 pi-ai clamp（就近取档，优先向上）

### web 端

web 的 Models tab 与 desktop 共用组件，控件可编辑但仅存 localStorage，对实际连接的 desktop server 无效果（与 sampling 现状一致），一期不额外处理，沿用既有限制。

## 已知取舍

- **不暴露 minimal/xhigh/max**：多数模型 thinkingLevelMap 只覆盖 3-4 档，UI 简洁优先；需要 xhigh/max 的用户待二期按模型动态档位时自然获得
- **全局值与 per-agent 模型可能不匹配**（profile.model 覆盖默认模型）：接受，pi-ai clamp 兜底；agent 级 frontmatter `thinking:` 覆盖作为后续可选扩展（同 `model:` 先例）
- **off 档**：pi-agent-core 中 `off` → `reasoning: undefined`，即关闭思考，可省 token
- **compaction 摘要不消费全局 thinkingLevel**（summarize 路径不传 reasoning，pi-agent-core compact 虽支持 thinkingLevel 参数）：一期不处理，摘要质量影响有限
- **读回路径是必须接缝**：`getMaskedSettings`/`maskModelGroup` 显式枚举字段，漏透传会导致表单加载不到 → 下次保存 payload 缺字段 → merge 语义（incoming 优先）静默清空存量值

## 验证

- core：`buildAgent` 消费 runConfig.thinkingLevel；`applyThinkingLevel` 变更检测；session-manager fan-out（不 mock 被测方法的契约测试，server/desktop 侧至少各一条）
- desktop：`electron/settings.test.ts` merge + mask 双向透传 thinkingLevel；ipc save-settings → updateThinkingLevel 链路
- server：registry.setThinkingLevel 对已注册/新注册 project 的种子与 fan-out（`MultiProjectServerOptions` 透传）
- app：use-settings-form 表单状态与 save payload；新字段 UI 结构测试
- i18n 三语 + `npm run check:i18n`；lint、typecheck、相关 workspace 单测

## 二期草图（composer 会话级覆盖，暂不实施）

- WS `chatClientMessage` message 变体加 `thinkingLevel?` 字段（contracts/websocket.ts，契约测试同步）
- `AgentRunner.sendMessage` 收到时在 turn 前一次性 `agent.state.thinkingLevel = override ?? 全局`
- Composer 增档位切换控件：state 按 sessionId sticky（类似 draft 键控），档位按当前生效模型的 `getSupportedThinkingLevels` 动态显示
