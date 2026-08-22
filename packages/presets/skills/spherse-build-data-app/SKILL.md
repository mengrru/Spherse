---
name: spherse-build-data-app
description: 设计和构建由 HTML 页面与 Agent 共同读写的 Spherse 数据型应用时使用；涵盖 *.data.json 建模、$manifest 命名查询与变更、UI SDK 和 data tools 协作、上下文节省与准确写入
---

# 构建数据型应用

数据型应用是由 HTML 页面和一个或多个 Agent 围绕同一份 `*.data.json` 持续互动的应用，例如虚拟论坛、任务系统、经营模拟、社区、知识库或工作流看板。

这套 data 能力有两个核心目标：

1. 让 Agent 通过业务命名的查询只获取当前任务所需的数据，避免每次读取整个数据文件占用上下文。
2. 让页面和 Agent 通过经过 schema 校验的原子 mutation 修改数据，避免手工编辑 JSON 时选错路径、写错字段或覆盖并发变更。

本 Skill 负责数据建模与协作方式。生成 HTML 时同时加载 `spherse-write-html`，查询 UI SDK 参数时加载 `spherse-use-ui-sdk`。

## 核心原则

- 数据会增长或需要 Agent 参与读写时，必须使用 `*.data.json` 并内嵌 `$manifest`。
- 先设计 Agent 会问的问题和会执行的业务动作，再设计 `queries` 和 `mutations`，最后生成页面。
- 把 `$manifest` 当作页面与 Agent 共享的业务接口，不只是数据结构说明。
- Agent 首次接触文件时用 `read_data` 获取 outline，后续优先使用 `query_data` 和 `mutate_data`。
- 页面和 Agent 对同一种业务写入必须调用同名 mutation，不能各自实现一套读改写逻辑。
- 集合条目必须有稳定 identity，通常是由 `auto` 生成的 UUID。
- manifest 保持精简（建议不超过 2KB），只保存路径映射、入口描述和 schema，不放示例数据。
- manifest 的 `path` 使用对象字段 dot-path（如 `forum.threads`），不支持数组下标。
- 创建参与互动的 Agent 时，根据职责显式启用所需的 data tools，并遵循最小权限原则。

## 设计工作流

### 1. 列出 Agent 的读取问题

从 Agent 的实际任务出发列出需要回答的问题，而不是先暴露整份数据。例如虚拟论坛中的 Agent 可能需要：

- 查看最新的开放主题
- 按板块查看主题
- 根据主题 ID 获取单个主题
- 查看某个主题下的回复

将高频、边界明确的问题设计为命名 query。query 名称应表达业务语义，例如 `listOpenThreads`、`listRepliesByThread`，不要使用 `getData`、`queryItems` 等模糊名称。

当前 query 引擎适合数组数据，支持：

- enum、string、integer、boolean 参数按同名字段相等过滤
- `identity` 字段精确定位单条记录
- `sort` + `dir` 排序
- `defaultLimit`、`limit` 和 `after` 分页

不要为了“以后可能需要”暴露大量入口。只声明页面或 Agent 确实会使用的查询。

### 2. 列出业务写入动作

把每种写入建模为命名 mutation：

| 业务动作 | mutation op | 示例 |
|---|---|---|
| 新增集合条目 | `append` | `createThread`、`addReply` |
| 按 identity 修改条目 | `update` | `setThreadStatus` |
| 按 identity 删除条目 | `remove` | `removeReply` |
| 合并更新对象 | `set` | `updateForumStats` |

mutation 名称描述业务动作，`fields` 只开放允许调用方写入的字段。使用 `required`、`enum` 和 `default` 固化数据约束；使用 `auto.uuid` 和 `auto.nowIso` 统一生成 identity 与时间。

`match` 用于 `update` 和 `remove` 定位条目，通常与对应 query 的 `identity` 相同。调用方把 match 字段放在 `args` 中传入，但不要在 `fields` 中重复声明。

### 3. 同源生成三部分

一次完成并保持一致：

1. `*.data.json` 的业务数据结构和 `$manifest`
2. HTML 的读取、渲染与 `spherse.data.mutate` 调用
3. 参与 Agent 的职责说明和 data tool 权限

检查每个页面写操作是否都有对应 mutation，每个 Agent 高频读取问题是否都有合适 query，字段名和 enum 是否与页面渲染逻辑完全一致。

### 4. 验证访问路径

完成后按真实角色检查：

- 页面能否读取渲染所需数据
- 页面 mutation 的返回值能否直接更新局部 UI
- Agent 能否从 outline 发现正确入口
- Agent 是否能用一页 query 结果完成常见任务
- 页面与 Agent 同时写入时是否都走同一 mutation

## 页面与 Agent 的能力映射

| 目的 | HTML 页面 | Agent |
|---|---|---|
| 读取顶层业务值 | `spherse.data.get` | `read_data` 的 `key` 或 `path` |
| 读取页面渲染所需集合 | `spherse.data.get` / `entries` | 不对应；Agent 应使用命名 query |
| 发现结构和入口 | 不需要 | 首次调用 `read_data`，省略 `key`/`path` |
| 按业务条件查询集合 | 当前无 UI SDK manifest query | `query_data` |
| 执行业务写入 | `spherse.data.mutate` | `mutate_data` |

页面可以读取渲染所需的较完整状态，因为数据进入浏览器而不是 LLM 上下文。Agent 不应照搬页面读取方式；它应使用 query 只取当前任务需要的一页数据。

## Agent 的标准访问流程

首次接触数据文件：

```text
read_data({ file: "forum.data.json" })
```

outline 会返回数据结构、version、manifest 健康状态以及可用 query/mutation 的参数签名。随后按入口调用：

```text
query_data({
  file: "forum.data.json",
  name: "listOpenThreads",
  params: { category: "general", sort: "createdAt", dir: "desc" },
  limit: 10
})
```

需要下一页时传上次结果的 `nextAfter`。已知 identity 时直接通过 query 的同名 identity 参数读取目标条目，不要扫描整个数组。

写入时：

```text
mutate_data({
  file: "forum.data.json",
  name: "addReply",
  args: { threadId: "thread-id", author: "Archivist", body: "我的看法……" },
  idempotencyKey: "session-id:reply:thread-id"
})
```

mutation tool 返回 `{ version, result }`，其中 `result` 是新增、更新或删除后的业务对象。对可能重试的新增操作提供稳定 `idempotencyKey`，避免重复追加。

如果 Agent 需要等待用户操作后重新检查状态，可用先前的 `version` 调 `read_data.ifVersion`；未变化时只返回 `unchanged`，减少重复数据进入上下文。

## 页面写入方式

页面执行集合结构性写入时调用与 Agent 相同的 manifest mutation：

```javascript
const reply = await spherse.data.mutate({
  file: "forum.data.json",
  name: "addReply",
  args: {
    threadId,
    author: displayName,
    body: draft,
  },
  idempotencyKey: submitId,
});

renderReply(reply); // reply 包含 auto 生成的 id 和 createdAt
```

UI SDK 的 `data.mutate` 直接返回业务对象：`append` 返回新增条目，`update` 返回更新后的条目，`remove` 返回被删除的条目，`set` 返回更新后的目标对象。

不要用 `data.get` 读出整个数组、在页面中修改后再用 `data.set` 写回。该模式会覆盖页面读取之后由其他 Agent 或页面写入的变更。

## 虚拟论坛示例

下面的模型让页面和 Agent 共享发帖、回复与状态修改能力，同时允许 Agent 分页读取与任务相关的数据。

```json
{
  "$manifest": {
    "version": 1,
    "desc": "虚拟论坛主题与回复",
    "queries": {
      "listOpenThreads": {
        "desc": "分页查看开放主题，可按板块过滤并排序",
        "path": "threads",
        "identity": "id",
        "params": {
          "status": { "type": "enum", "values": ["open", "closed"], "default": "open" },
          "category": { "type": "enum", "values": ["general", "ideas", "support"] },
          "sort": { "type": "field" },
          "dir": { "type": "enum", "values": ["asc", "desc"], "default": "desc" }
        },
        "defaultLimit": 20
      },
      "getThread": {
        "desc": "根据 ID 获取单个主题",
        "path": "threads",
        "identity": "id",
        "defaultLimit": 1
      },
      "listRepliesByThread": {
        "desc": "分页查看指定主题的回复",
        "path": "replies",
        "identity": "id",
        "params": {
          "threadId": { "type": "string" },
          "sort": { "type": "field" },
          "dir": { "type": "enum", "values": ["asc", "desc"], "default": "asc" }
        },
        "defaultLimit": 30
      }
    },
    "mutations": {
      "createThread": {
        "desc": "创建论坛主题",
        "op": "append",
        "path": "threads",
        "fields": {
          "title": { "type": "string", "required": true },
          "body": { "type": "string", "required": true },
          "author": { "type": "string", "required": true },
          "category": { "type": "enum", "values": ["general", "ideas", "support"], "required": true },
          "status": { "type": "enum", "values": ["open", "closed"], "default": "open" }
        },
        "auto": { "id": "uuid", "createdAt": "nowIso" }
      },
      "addReply": {
        "desc": "向主题追加回复",
        "op": "append",
        "path": "replies",
        "fields": {
          "threadId": { "type": "string", "required": true },
          "author": { "type": "string", "required": true },
          "body": { "type": "string", "required": true }
        },
        "auto": { "id": "uuid", "createdAt": "nowIso" }
      },
      "setThreadStatus": {
        "desc": "打开或关闭主题",
        "op": "update",
        "path": "threads",
        "match": "id",
        "fields": {
          "status": { "type": "enum", "values": ["open", "closed"], "required": true }
        }
      },
      "removeReply": {
        "desc": "删除回复",
        "op": "remove",
        "path": "replies",
        "match": "id"
      }
    }
  },
  "threads": [],
  "replies": []
}
```

注意：当前 query 只能按记录自身字段过滤，因此回复记录冗余保存 `threadId`，使 `listRepliesByThread` 可以直接查询。不要为了追求关系型范式而让 Agent 读取多个完整集合并自行 join；应按实际查询路径设计适度冗余。

## 建模检查清单

- 文件名以 `.data.json` 结尾，业务数据位于顶层 object，业务键不以 `$` 开头。
- manifest 保持精简，`path` 不使用数组下标。
- 每个增长型集合都有稳定 identity；新增入口通过 `auto.uuid` 生成它。
- 时间字段统一通过 `auto.nowIso` 生成，不让不同调用方自行格式化。
- query 覆盖 Agent 高频问题，并设置合理的 `defaultLimit`。
- 需要稳定分页的 query 声明 `identity`。
- mutation 使用业务名称，`fields` 只允许预期字段，状态类字段使用 enum。
- 页面和 Agent 的相同写入动作共用同名 mutation。
- 页面不通过 `data.set` 整体回写增长型集合。
- Agent 首次读取 outline，后续优先 query/mutate，不反复读取整个文件。
- manifest 与 HTML、初始数据、Agent 指令中的字段和入口名称一致。

## 何时不使用这套模型

- 一次性静态展示且不会由页面或 Agent 修改的数据，不需要 `$manifest`。
- 大量二进制内容不应塞入 JSON；在数据中只保存项目文件路径。
- 如果单文件持续接近 20MB、需要复杂关联查询或高频写入，应重新拆分数据文件；当前能力的重点是受控 JSON 协作，不是通用数据库替代品。
