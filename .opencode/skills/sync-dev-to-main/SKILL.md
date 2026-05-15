---
name: sync-dev-to-main
description: Use when the user says "sync dev to main", "release to main", or wants to fast-forward dev's commits to main preserving full history
---

# Sync Dev to Main

## Overview

将 dev 分支的 commit 历史完整同步到 main 分支。不产生 merge commit，不 squash，保留 dev 上的每一条 commit 记录（fast-forward merge）。

## When to Use

- 用户说 "sync dev to main"、"release to main"、"同步 dev 到 main" 等指令
- 一个开发周期结束，dev 上积累了若干 feature，需要发布到 main

## Steps

1. **确认 dev 和 main 的差异**
   ```bash
   git log --oneline main..dev
   ```
   展示将要同步到 main 的 commit 列表，让用户确认。

2. **切换到 main 并拉取远端更新**
   ```bash
   git checkout main
   git pull
   ```
   如果 checkout 失败（worktree 中 main 被其他工作目录占用），提示用户切换到 main 所在的工作目录。

3. **执行 fast-forward merge**
   ```bash
   git merge --ff-only dev
   ```

4. **推送到远端**
   ```bash
   git push
   ```

5. **展示结果**
   ```bash
   git log --oneline -5
   ```
   显示 main 上最新的 commit，确认同步成功。

## Edge Cases

- **dev 落后于 main**：说明 main 上有 dev 没有的 commit，`--ff-only` 会失败。提示用户需要先在 dev 上 rebase 或 merge main。
- **main 被 worktree 占用**：提示用户切换到 main 所在的工作目录执行。
- **dev 与 main 已同步**：提示无需操作。
- **有未提交的更改**：提示用户先处理工作区的更改。

## Why --ff-only

使用 `--ff-only` 确保：
- 不会产生额外的 merge commit
- main 的历史就是 dev 的历史的完整延续
- 如果无法 fast-forward（main 有独立的 commit），会明确报错而不是静默创建 merge commit
