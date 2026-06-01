# Bugfix: 修复 edit tool 对同一文件的并发写问题

## 问题描述

LLM 在一次回复中可能对同一文件发出多个 `edit_file` tool call。由于 pi-agent-core 默认以 `parallel` 模式执行 tool calls，多个 `edit_file` 调用会并发执行。`edit_file` 内部是非原子的 read-modify-write（读文件 → 字符串替换 → 写回文件），并发执行时后写入的会覆盖先写入的修改，导致文件内容被写乱。

该问题同样影响以下并发场景：

- 跨 session：用户同时开两个 chat session 编辑同一项目文件
- 前端并发：用户在前端 ContentBrowser 编辑文件的同时 agent 也在修改同一文件

## 根因分析

1. `Engine.buildAgent()` (`engine.ts:191`) 创建 Agent 时未设置 `toolExecution`，默认为 `"parallel"`
2. `edit_file`、`write_file`、`append_changelog` 工具均未设置 `executionMode`
3. 当 LLM 返回多个 tool call 时，`executeToolCallsParallel()` 通过 `Promise.all()` 并发执行所有调用
4. `edit_file` 的 read-modify-write 无任何锁保护，并发写同一文件时会丢失更新

## 方案

### per-file 互斥队列（FileWriteMutex）

在 `packages/core` 中新增 `FileWriteMutex` 类，维护一个 `Map<string, Promise<void>>` 作为 per-file 操作队列。所有文件写操作通过 `mutex.run(absolutePath, fn)` 执行，对同一文件的写操作自动序列化，不同文件的写操作可并行。

**选择此方案的理由：**

- 覆盖所有入口（单 session LLM 并行、跨 session、前端 PUT 路由）
- 实现简洁（~25 行核心代码），无外部依赖
- 精准锁定范围：per-file 粒度，不影响不同文件间的并行性

## 设计

### 1. 核心组件：FileWriteMutex

**新增文件**：`packages/core/src/tools/file-write-mutex.ts`

```typescript
export class FileWriteMutex {
  private queues: Map<string, Promise<void>> = new Map();

  async run<T>(absolutePath: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(absolutePath) ?? Promise.resolve();
    let resolve: () => void;
    const next = new Promise<void>((r) => { resolve = r; });
    this.queues.set(absolutePath, next);

    try {
      await prev;
      return await fn();
    } finally {
      resolve!();
      if (this.queues.get(absolutePath) === next) {
        this.queues.delete(absolutePath);
      }
    }
  }
}
```

语义：对同一 `absolutePath`，`run()` 保证回调按调用顺序依次执行（前一个完成后再执行下一个）。不同 path 的回调可并行。回调抛异常不影响后续操作。

### 2. 集成方式

**Engine 层**：

- `Engine` 构造函数中创建 `FileWriteMutex` 单例
- `buildAgent()` 中将 mutex 传给 `createToolsForProject()`
- Engine 暴露 `getFileWriteMutex()` getter

**工具层**：

- `createToolsForProject()` 签名增加 `mutex: FileWriteMutex` 参数
- `createEditFileTool(projectRoot, mutex)`：将 read-modify-write 整体包裹在 `mutex.run()` 中
- `createWriteFileTool(projectRoot, mutex)`：将 mkdir + writeFile 包裹在 `mutex.run()` 中
- `createAppendChangelogTool(projectRoot, changelogPath, mutex)`：将 appendFile 包裹在 `mutex.run()` 中
- 只读工具（`read_file`、`list_files`、`search_content`）不使用 mutex

**Server 层**：

- `AppContext` 新增 `fileWriteMutex` 字段
- `createServer()` 中从 `engine.getFileWriteMutex()` 取出并赋给 ctx
- `content.ts` PUT 路由中 `fs.writeFile` 包裹在 `ctx.fileWriteMutex.run()` 中

### 3. 改动清单

| 文件 | 改动 |
|------|------|
| `packages/core/src/tools/file-write-mutex.ts` | 新增，FileWriteMutex 类 |
| `packages/core/src/tools/edit-file.ts` | 构造函数接收 mutex，execute 中用 mutex.run() 包裹 |
| `packages/core/src/tools/write-file.ts` | 构造函数接收 mutex，execute 中用 mutex.run() 包裹 |
| `packages/core/src/tools/append-changelog.ts` | 构造函数接收 mutex，execute 中用 mutex.run() 包裹 |
| `packages/core/src/tools/index.ts` | createToolsForProject 增加 mutex 参数，传递给三个写工具 |
| `packages/core/src/engine.ts` | 创建 mutex 单例，传给 createToolsForProject，暴露 getter |
| `packages/core/src/index.ts` | 导出 FileWriteMutex |
| `packages/server/src/index.ts` | AppContext 增加 fileWriteMutex 字段 |
| `packages/server/src/routes/content.ts` | PUT 路由使用 mutex.run() |

### 4. 测试

在 `packages/core/src/tools/` 下新增 `file-write-mutex.test.ts`：

- **串行化验证**：对同一 path 发起 3 次并发 `run()`，验证回调按顺序依次执行（非交错）
- **并行性验证**：对不同 path 发起并发 `run()`，验证它们并行执行
- **异常隔离验证**：第一次 `run()` 抛异常，验证第二次 `run()` 正常执行并返回正确结果
- **Map 清理验证**：所有操作完成后，验证 `queues` Map 中无残留条目
