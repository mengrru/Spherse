# Spike: Provider CORS 矩阵实测（P0）

- 日期：2026-11-22
- 状态：**完成**（浏览器 origin 实测 + OPTIONS 预检 curl 复核双重确认）
- 关联设计：`docs/dev/infra/2026-11-21-plugin-runtime-rpc/design.md`（风险表「CORS 矩阵含不可直连 provider」；原文「Anthropic 确认可直连」结论已过时，见下）
- 探测方法：浏览器 origin（localhost:5199）对 catalog 中各 provider 实际 endpoint 发 `POST`（Authorization 假 key + JSON body），fetch 可读响应（哪怕 401）= 允许直连；`TypeError` = 拒绝。再以 `OPTIONS` 预检 curl（Origin + ACRM + ACRH）复核每个结论。

## 矩阵（endpoint 取自 `@earendil-works/pi-ai@1.3.0` catalog 实际 baseUrl）

| Provider | Endpoint | 浏览器直连 | 预检响应 |
|---|---|---|---|
| OpenRouter | openrouter.ai/api/v1 | ✅ | 204，`ACAO:*`，头白名单含 Authorization |
| zai（GLM coding） | open.bigmodel.cn/api/coding/paas/v4 | ✅ | 200，`ACAO:<origin>` 回显 |
| DeepSeek | api.deepseek.com | ✅ | 200，`ACAC:true`（credentials 模式） |
| MiniMax | api.minimax.io / api.minimaxi.com（anthropic 面） | ✅ | 200，`ACAO:<origin>` 回显 |
| 小米 | api.xiaomimimo.com/v1 | ✅ | 200，`ACAO:*` |
| Moonshot | api.moonshot.ai 与 .cn | ✅ | 204，`ACAC:true` |
| Qwen（dashscope 标准） | dashscope.aliyuncs.com/compatible-mode/v1 | ✅ | 200，`ACAO:*` |
| Qwen（token-plan） | token-plan.*.maas.aliyuncs.com | ❌ | 预检 401 无 CORS 头 |
| Kimi | api.kimi.com/coding/v1 | ❌ | 预检 404 无 CORS 头 |
| OpenAI | api.openai.com/v1 | ❌（官方公开策略明确不支持浏览器直连） | 本网络不可达，未直接观测；按官方文档判定 |
| Anthropic | api.anthropic.com/v1 | ❌ **（修正设计文档旧结论）** | 预检 403，无任何 `access-control-*` 头 |
| Google | generativelanguage.googleapis.com | 待外网补测 | 本网络不可达；公开信息倾向 ✅（官方 API 支持 CORS） |

## 结论与落地影响

1. **主用国内 provider 全绿**：zai/DeepSeek/Moonshot/MiniMax/小米/dashscope-Qwen 浏览器可直连——Spherse 主用户面的 browser 版 provider 可用性良好。
2. **Anthropic 修正**：设计文档中「Anthropic 确认可直连」与实测不符（预检 403 拒绝）。Anthropic 官方对 browser 直连的态度是要求走代理（dangerouslyAllowBrowser 同款限制的对面）。browser 版对 Anthropic 走「不可直连」处理。
3. **不可直连清单**（OpenAI / Anthropic / Kimi / token-plan-Qwen）：按设计风险表预案——提示改走 OpenRouter / 自定义 baseUrl 兼容网关，不引入自有代理服务。
4. Google 待外网环境补测一次即闭环（预期可，非阻塞）。

## 探测脚本

临时区 `cordis-spike/`：`cors.html` + `src/cors-probe.ts`（浏览器 origin 探测）+ `cors-spike.mjs`（playwright 驱动）。预检 curl 复核命令见本文件探测方法段，可直接复跑。
