# GPT-6 Astra 与思考强度

## 范围与现状

用户要求通过 API 使用 GPT-6 Astra 并设置 thinking effort。本次以 OpenAI 官方 API 为接入范围，沿用现有全局文本模型设置和下一轮生效语义。

pi-ai / pi-agent-core 0.84.4 已支持 Responses API、`xhigh`、`max`，但模型目录缺少 Astra。Spherse 的 `ThinkingLevel` 与设置界面只暴露 `off / low / medium / high`。现有采样注入会把 temperature 与 top_p 无条件加入 OpenAI 请求。

## 设计

- 在每个 `ModelCatalog` 的 OpenAI provider 上补充 `gpt-6-astra`，保留原 provider 的认证和流式实现；若上游已有该模型则复用上游条目。
- 使用 `openai-responses`，模型输入支持文字和图片，contextWindow 为 1,050,000，maxTokens 为 128,000。标准价格及超过 272,000 输入 token 的价格分层采用官方模型页数值。
- 档位映射只支持 `low / medium / high / xhigh / max`；`off`、`minimal` 不受支持。聊天请求在未提供 reasoning（Agent 的 off）时显式使用 low，其余值由 pi-ai 按模型支持范围归一化。
- 扩展现有全局 `ThinkingLevel` 和下拉框，增加 `xhigh`、`max`，继续默认 medium。新设置沿用现有保存、读回、registry 和会话传播链，无新增存储位置或 WS 消息字段。
- 在 Astra provider 的 stream / streamSimple 两个入口包装 onPayload，忽略 temperature / top_p / top_logprobs，移除不受支持的日志概率 include。保留调用方 onPayload 的行为，再执行 Astra 参数清理；topP 注入须组合已有回调。
- 将旧 prompt_cache_retention 迁移到 prompt_cache_options.ttl=30m；声明 supportsExplicitPromptCacheMode，使 cacheRetention=none 使用 explicit 模式且不设置断点。覆盖普通聊天和直接消费 catalog 的摘要路径。
- 同步中英繁三语提示：GPT-6 Astra 选择关闭思考时使用 low。保持其他模型的采样和档位行为。
- 自定义 Base URL 协议扩展、会话级快捷切换与现有默认模型替换不在本次范围。

## 验证

- 真实 ModelCatalog + pi-ai 适配器的 HTTP 请求截获测试，验证目录、Responses URL、五档 effort、off 降到 low、工具声明、禁用采样参数和普通模型回归。
- 设置组件选档、表单保存读回和 desktop 持久化覆盖 xhigh / max。
- lint、build、typecheck、受影响 workspace 测试与 i18n 检查。
- 不使用用户密钥发起付费请求；真实账户的模型授权需要配置后验证。

## 来源

- https://developers.openai.com/api/docs/models/gpt-6-astra
- https://developers.openai.com/api/docs/guides/latest-model

官方文档核对日期：2026-09-07。

## 设计审查

- important（已采纳）：pi-ai 在 long 缓存模式下仍发送旧 prompt_cache_retention；增加 Astra 专属迁移，并覆盖 short / long / none。
- medium（已采纳）：不能把 Astra 的 off→low 行为描述为所有模型的保证；提示限定 Astra。

## 文档同步检查

| 检查项 | 结果 |
|---|---|
| 文件与目录 | project-structure 的 model-providers 条目补充 Astra；测试与过程文档沿用既有目录分组 |
| 架构与装配 | desktop 域同步 provider 请求兼容和配置传播；未改变 package 边界或 capability 装配方式 |
| ADR | 无新增架构决策，沿用 pi-ai provider 与现有全局设置机制 |
| 数据格式 | data-conventions 增加用户级思考强度存储位置链接；desktop 权威定义补齐档位 |
| 术语 | 沿用模型、provider、思考强度，无新增概念 |
| 包级规范 | 无规范变化 |
| 用户文案 | i18n 三语新增 xhigh/max 并修改提示 |
| 主题 | 无 token、主题机制、聊天布局或 hook 变更 |
| presets | 无源文件变更；已运行依赖构建 |
| backlog | 会话级覆盖条目仍属独立二期，未完成也未删除 |
| 用户规范修正 | 无新增约定 |
| 工具与命令 | 沿用现有验证命令 |

## 验证记录

- core 定向测试 80 项通过：Astra 请求、既有采样、自定义 provider UA、会话参数传播。
- app 全量 1,016 项通过；desktop settings / IPC 定向 36 项通过；i18n 校验通过。
- 全仓 lint 无错误（16 项已有 warning），build 与 typecheck 通过。
- `npm run verify` 未全通过：其他 core 测试存在 Windows 文件句柄清理 / POSIX 权限假设问题，server 的 lastOpened 断言失败，desktop 的项目路径断言使用 POSIX 分隔符。相关实现与 origin/dev 相同。
- 本次触及的 session-manager 测试修复了清理前未 shutdown 导致的 Windows EPERM；修复后 47 项独立复测通过。全仓运行在该修复前已加载此文件，其报告仍包含该组旧失败。
