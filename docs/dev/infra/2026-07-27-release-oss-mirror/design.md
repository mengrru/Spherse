# [infra] Release Pipeline 上传 Artifacts 到阿里云 OSS（国内下载镜像）

## 背景

当前 release pipeline（`.github/workflows/build-and-release.yml`）由 `v*` tag push 触发，在 3 个并行 runner（macOS arm64 / macOS intel / Windows）上构建安装包并上传到 GitHub Release。Landing page 的下载按钮通过 `fetch(GitHub Releases API)` 取最新版本资产，重定向到 `github.com/.../releases/download/...`。

问题：国内用户访问 GitHub Releases 不稳定，下载经常超时。GitHub API 本身在境内同样不稳定，landing page 的下载链接解析也可能失败。

本方案在发版流水线中新增上传 artifacts 到阿里云 OSS 的步骤，作为**国内下载镜像**：landing page 改为从 OSS 读取版本清单，下载按钮直指 OSS。**electron-updater 自动更新链路不动**，仍走 GitHub Releases，避免改动发版主线风险面。

### 需求

| 需求 | 优先级 |
|------|--------|
| 每次 tag release 把 3 个安装包（dmg×2、exe）同步上传到阿里云 OSS | P0 |
| OSS 保留每个版本（版本化路径），不覆盖历史 | P0 |
| 提供稳定 URL 的版本清单（`latest.json`），landing page 据此解析下载链接 | P0 |
| landing page 完全脱离 GitHub API，下载按钮直指 OSS | P0 |
| electron-updater 自动更新链路保持原状（GitHub Releases） | P0 |
| 不改动 build matrix，OSS 逻辑隔离在独立 job | P0 |
| 失败可见：OSS 上传失败应让 workflow 失败 | P0 |

### 关键决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| OSS 角色 | 国内下载镜像，非自动更新源 | 自动更新走 GitHub Releases 是已验证的稳定链路；OSS 只解决「国内首次下载/手动下载慢」，风险面最小 |
| Workflow 结构 | 方案 A：集中式独立 `publish-oss` job | build matrix 零改动，OSS 逻辑隔离；latest.json 原子生成无竞态；唯一代价是从 GitHub Release 多下载一次 artifact（GitHub 内网秒级） |
| 对象路径布局 | 版本化路径 `{bucket}/spherse/releases/{ver}/<file>` + 稳定 `{bucket}/spherse/latest.json` | 保留历史版本 + 稳定清单 URL；landing 无需知道具体版本号 |
| 文件命名 | **保留 GitHub Release 原始文件名**（不重命名） | 从根本上保证 OSS 与 Release artifact 大小写/命名完全一致；latest.json 在生成时 glob 发现真实文件名 |
| 上传工具 | 阿里云官方 `ossutil`（linux amd64 二进制，curl 下载） | 第一方、成熟、无第三方 action 依赖 |
| 失败策略 | OSS 失败 → workflow 失败 | landing 即将依赖 OSS，stale/broken 不能悄悄放过 |

## 方案选型

对比了三种 workflow 结构：

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A. 集中式独立 job（选定）** | build matrix 零改动；OSS 逻辑集中；单份 ossutil 二进制；manifest 原子生成 | 从 GitHub Release 重新下载一次 artifact（~300MB，GitHub 内网可忽略） |
| B. 分布式（每个 matrix job 直传 OSS + 单独 manifest job） | artifact 直传 OSS，无重新下载 | 需在 macOS/Windows runner 各装 ossutil（跨平台二进制名不同）；发版主线风险面变大；manifest job 仍需单独协调 |
| C. electron-builder 多 provider publish | — | electron-builder 不支持 OSS provider；`generic` provider 是消费端而非上传端，不适用 |

选定 **方案 A**。

## 详细设计

### 1. OSS 对象布局

```
{bucket}/
  spherse/
    latest.json                              ← 每次 release 覆盖（稳定 URL）
    releases/
      1.2.3/
        Spherse-1.2.3-arm64.dmg
        Spherse-1.2.3-intel.dmg
        Spherse Setup 1.2.3.exe              ← electron-builder 默认 NSIS 名，原样保留
      1.2.4/
        ...
```

根目录统一加 `spherse/` 前缀，与 bucket 上可能存在的其它内容隔离。

### 2. `latest.json` schema

```json
{
  "version": "1.2.3",
  "mac": {
    "arm64": "<base>/spherse/releases/1.2.3/Spherse-1.2.3-arm64.dmg",
    "intel": "<base>/spherse/releases/1.2.3/Spherse-1.2.3-intel.dmg"
  },
  "win": {
    "setup": "<base>/spherse/releases/1.2.3/Spherse Setup 1.2.3.exe"
  }
}
```

`<base>` = 仓库 Variable `OSS_PUBLIC_BASE_URL`（如 `https://download.spherse.cn` 或 OSS 默认公网域名）。文件名由 publish-oss job 在生成时 glob 实际下载到的 artifact，保证大小写与 Release 完全一致。

### 3. Workflow 改动（`.github/workflows/build-and-release.yml`）

- `on:` 新增 `workflow_dispatch:`，方便手动重跑（重发 OSS / 调试）。
- 新增 `publish-oss` job，`needs: build`，`runs-on: ubuntu-latest`，步骤：

  1. 解析版本号 `VER=${GITHUB_REF_NAME#v}`。
  2. curl 下载官方 `ossutil`（linux amd64）。
  3. `gh release download <tag> -D ./oss-out --pattern '*.dmg' --pattern '*.exe' --clobber`。
  4. glob 发现真实文件名：`*arm64*.dmg` / `*intel*.dmg` / `*.exe`。
  5. 对每个文件 `ossutil cp ... oss://${BUCKET}/spherse/releases/${VER}/<basename>`（`--force -u`，可重跑）。
  6. 用 `jq -n` 构造 latest.json（注入 version + 各平台 URL），`jq empty` 校验合法。
  7. `ossutil cp latest.json oss://${BUCKET}/spherse/latest.json --force -u`。

build matrix（`create-release`、`build`）**完全不动**。

### 4. Landing page 改动（`packages/landing/src/lib/release.ts`）

- 删除 `RELEASES_API` / `fetchLatestRelease()`（GitHub API 路径）。
- 新增 `fetchLatestManifest()`：`fetch(${import.meta.env.VITE_OSS_MANIFEST_URL ?? FALLBACK})`，解析为 `{ version, mac: { arm64, intel }, win: { setup } }`。
- `resolveDownloadUrl(platform)`：
  - manifest 命中 → win 返回 `manifest.win.setup`；mac 返回 `manifest.mac[detectMacArch()]`。
  - fetch 失败 / 字段缺失 → 回退 `FALLBACK_URL`（`https://github.com/mengrru/Spherse/releases/latest`，给能上 GitHub 的用户兜底）。
- `detectPlatform` / `detectMacArch` 保持不变。

### 5. `deploy-pages.yml` 改动

- landing build 步骤注入 env：`VITE_OSS_MANIFEST_URL: ${{ vars.OSS_PUBLIC_BASE_URL }}/spherse/latest.json`。
- 仓库 Variable `OSS_PUBLIC_BASE_URL` 未配置时，build 仍通过（landing 在运行时回退到 FALLBACK_URL），不阻塞 Pages 部署。

### 6. 新增 Secrets / Variables

**Secrets**（敏感，配在 repo Settings → Secrets and variables → Actions → Secrets）：

| 名称 | 示例值 |
|------|--------|
| `OSS_ACCESS_KEY_ID` | `LTAI...` |
| `OSS_ACCESS_KEY_SECRET` | `(RAM 用户 AccessKey Secret)` |
| `OSS_ENDPOINT` | `oss-cn-hangzhou.aliyuncs.com` |
| `OSS_BUCKET` | `spherse-releases` |

**Variables**（非敏感，配在 repo Settings → Secrets and variables → Actions → Variables）：

| 名称 | 示例值 | 用途 |
|------|--------|------|
| `OSS_PUBLIC_BASE_URL` | `https://download.spherse.cn` | publish-oss 拼 latest.json URL + deploy-pages 注入 landing |

RAM 用户最小权限：对目标 bucket 的 `oss:PutObject`（上传到 `spherse/*` 前缀即可）。

## 验证

- **landing 无单测基建**（package 无 vitest 依赖）：不为单函数引入测试脚手架。`resolveDownloadUrl` 实现保持简单 + 双路径（manifest 命中 / fetch 失败回退）显式可读，靠人工与集成验证。
- **workflow 手动触发**：`on: workflow_dispatch` 后可在 Actions 页面手动跑 publish-oss（含重新生成 latest.json），无需打新 tag。
- **latest.json 合法性**：上传前 `jq empty` 校验。
- **首次实跑**：配置好 Secrets/Variables 后，打一个测试 tag（如 `v0.0.0-oss-test`）触发完整流水线，验证 OSS 对象、latest.json 内容、landing page 下载按钮。
- **回退**：若 OSS 临时故障，landing 自动回退 GitHub Releases 页面；自动更新不受影响。

## 不在范围内

- electron-updater 改 provider / latest.yml 上传 OSS（保持 GitHub Releases 自动更新源）。
- 按地域/语言切换 OSS vs GitHub（一律走 OSS + GitHub 兜底）。
- STS 临时凭证 / 签名 URL（bucket public-read）。
- 给 landing 引入测试框架。
