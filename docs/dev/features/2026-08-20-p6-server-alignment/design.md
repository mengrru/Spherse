# P6 Server 对齐设计（catalog 所有权 / 写入门面 / ctx 收敛）

- 日期：2026-08-20
- 前置：`docs/dev/features/2026-08-19-core-kernel-refactor/`（P0-P5 已完成并提交 551306a）
- 状态：设计定稿

## 背景

P0-P5 完成后，core 已是微内核 + Capability 架构，但为守住「server/desktop 零改动」约束留下了三处妥协：

1. **#3 model catalog 全局 facade**：desktop `settings.ts` 进程级 `syncCustomProviders` 写模块全局可变状态；server routes、core model-resolver/agent-assembly 读同一全局。core 拥有进程级状态，catalog 生命周期 ≠ runtime 生命周期。
2. **#2 `pm.getFileWriteMutex()` 泄漏**：attachments/content/settings 三个 server route 借 PM 的锁句柄自己做 `fs.writeFile`，锁的执行依赖调用方自觉。
3. **#1 ProjectCtx 三字段并列**：server registry 把 `projectManager` / `sessionRuntime` / `triggerManager` 拆开传递。

## 方案

### #3 Model Catalog 所有权上移组合根（方案 B：组合根单实例，注入各 runtime）

所有权归组合根（desktop main / server registry），core 变纯：

- **core**：`RuntimeDeps.modelCatalog: ModelCatalog`；`createRuntimeDeps` 从 catalog 派生 `ModelResolver`（`resolveOf(catalog.resolveModelById)`）；`assembleProject({ modelCatalog? })` 缺省 `new ModelCatalog()`；`agent-assembly` 的 `composeStreamFn` 改用注入 catalog 的 `getChatStreamFn`；`status.resolveContextWindow` 改收 resolver 参数；**`model-providers/index.ts` 可变导出退役**（`syncCustomProviders` / `getChatStreamFn` / `resolveModelById` / `getChatModels` / `getSupportedProviders`）——只留 images 静态目录（env 驱动，无自定义变更）
- **desktop main**：组合根创建 `appModelCatalog` 单例；`applySettingsToEnv` 的 sync 目标改为该实例；IPC `getSupportedProviders` 读该实例
- **server**：registry 持有 catalog（构造参数传入，desktop 侧注入共享实例），open project 时传给 `assembleProject`；routes/settings 经 registry 读取

共享即广播：所有 runtime 持同一实例，settings 变更 sync 一次全体可见——与今日进程内共享 + in-place 更新语义一致，无时序问题。

### #2 写入门面（锁退役为 core 内部实现细节）

- **core**：`ProjectManager` 新增 `writeFile(rel, content)`（resolveProjectPath + `serverAccessPolicy.assertWrite` + per-path FileWriteMutex + fs.writeFile）与 `writeBinaryFile`（attachments 落盘用）；`getFileWriteMutex()` 标记 `@deprecated` 并从 PM 移除（route 全部迁移后删除）
- **server**：content.ts（用户编辑保存）、attachments.ts（上传落盘）、settings.ts（welcomePage/主题类写路径如有）改调 core 写入 API
- **边界（现状保持，不因本次变化）**：mutex 只保证写不撕裂（两次完整写串行，后写覆盖先写），不做乐观并发控制；用户编辑器与 agent 并发改同一文件的语义冲突仍靠前端 dirty 状态 + fs.watch 提示兜底

### #1 ProjectCtx 收敛

- registry 的 `ProjectCtx` 从三字段改为 `{ runtime: ProjectRuntime, projectManager, sessionRuntime, triggerManager }`——后三者变 runtime 的转发糖（`Object.freeze` 后 getter），route 代码字段访问不变但真相源唯一
- 后续新增能力只挂 runtime.capabilities，不再扩 ctx 字段

## 验证

- core：model-catalog 注入测试更新（vi.mock 全局拦截改为 stub catalog 注入）；catalog 实例隔离测试保留
- server：routes 单测（content 写入经 PM 门面）+ verify
- desktop：settings 联动单测（syncCustomProviders 改实例方法后 main 初始化顺序）
- E2E：chat-retry / agent-list / file-tree（涉及 content 写入）+ verify:e2e 收尾
