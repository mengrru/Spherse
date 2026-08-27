# ADR-0003：唯一装配点（组合根），运行期不做缝合

- 状态：accepted
- 日期：2026-06-15（Engine 拆解确立）；2026-08-19 kernel 重构后形态定型
- 影响：`packages/core/src/factory.ts`（assembleProject）、desktop main、全部依赖注入链

## 背景

Engine god object 拆解为 store / runtime / capability 时，依赖缝合点如果分散在各模块构造函数里自建（各自 new、互相 setter），依赖图会重新变得不可读、测试无法独立构造。

## 决策

- `assembleProject` 是 core 内唯一组合根：store → ProjectManager → SessionManager → capability init → ProjectRuntime，装配顺序固定
- desktop main 是全局组合根（settings、ModelCatalog 单例、server 装配）；web 壳不是组合根
- 运行期没有 setter 或 ref 缝合；`FileWriteMutex`、logger 等在装配点构造、全链路注入

## 后果

- 正：依赖图静态可读；新依赖必须动装配点，天然出现在 review 视野里
- 负：装配点会成为热点文件；跨包新增依赖要改组合根而非就近自建（这是特性不是缺陷）

## 原始记录

- `docs/dev/infra/2026-06-15-core-runtime-refactor/`
- `docs/dev/features/2026-08-19-core-kernel-refactor/`
