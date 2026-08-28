---
name: release-new-version
description: Use when the user says "发新版本", "release", "publish a new version", or wants to tag and ship a new Spherse release
---

# Release New Version

## Overview

发布新版本 = 同步 dev → main + 打 git tag 并推送。CI（`.github/workflows/build-and-release.yml`）会从 tag 自动同步版本号、构建安装包、上传到 GitHub Release 和阿里云 OSS 镜像。不需要手动修改 `package.json` 的 version。

## When to Use

- 用户说「发新版本」「release」「发布 v0.1.x」等指令
- 一个开发周期结束，准备发布新版本

## Steps

1. **确认工作区干净**
   ```bash
   git status --short
   ```
   如果有未提交的更改，提示用户先处理。

2. **同步 dev 到 main**
   ```bash
   git fetch origin
   git checkout dev && git pull
   git checkout main && git pull
   git log --oneline main..dev
   ```
   展示 dev 领先于 main 的 commit 列表；为空则跳过本步剩余动作。
   ```bash
   git merge --ff-only dev
   git push
   ```

3. **查看自上个 tag 以来的 commit**
   ```bash
   git tag --sort=-creatordate | head -1   # 获取最新 tag
   git log --oneline <latest-tag>..main    # 查看待发布 commit
   ```
   展示给用户确认版本范围正确。

4. **创建并推送 tag**
   ```bash
   git tag v<version>
   git push origin v<version>
   ```
   tag 格式为 `v` + 语义化版本号（如 `v0.1.12`）。

5. **确认 CI 触发**
   提示用户可在 GitHub Actions 页面查看构建进度。CI 会：
   - 创建 GitHub Release（`--generate-notes` 自动生成 release notes）
   - 构建 macOS arm64/intel DMG + Windows x64/arm64 EXE
   - 上传到 GitHub Release
   - 上传到阿里云 OSS 镜像 + 更新 `latest.json`
   - 全量重建 changelog 并上传 OSS `spherse/changelog.json`（landing `/download` 页消费）

## Key Knowledge

- **不需要手动改 version**：CI step `Sync app version from tag`（build-and-release.yml:62-64）执行 `npm version "${GITHUB_REF_NAME#v}" --no-git-tag-version`，从 tag 名自动设置 `packages/desktop` 的版本号。
- **`packages/desktop/package.json` 的 version 平时保持 `0.1.0`**，不随发布更新，只在 CI 构建时临时设置。
- **tag push 即触发**：workflow 监听 `push.tags: ["v*"]`，推送 tag 自动启动全流程。
- **changelog 可自愈重建**：`publish-changelog` 为全量重建（幂等），changelog 内容异常或 OSS 文件丢失时，手动 workflow_dispatch 该 workflow（输入任一已发布 tag）即可重新生成上传，无需发新版本。
- **为什么 --ff-only**：不产生 merge commit，main 的历史是 dev 历史的完整延续；无法 fast-forward 时明确报错而不是静默创建 merge commit。

## Edge Cases

- **dev 落后于 main**：main 上有 dev 没有的 commit（如 hotfix 直接落在 main），`--ff-only` 失败——提示用户先在 dev 上 merge main 再重试。
- **分支被 worktree 占用**：checkout 失败时，提示用户切换到对应分支所在的工作目录执行。
- **跳过版本号**：用户可能跳过某些版本号（如从 v0.1.10 直接到 v0.1.12），直接按用户指定的版本号打 tag 即可。
- **tag 已存在**：`git tag` 会报错，提示用户确认版本号或删除旧 tag 后重打。
