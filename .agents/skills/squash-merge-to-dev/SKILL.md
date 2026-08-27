---
name: squash-merge-to-dev
description: Use when the user says "squash merge to dev", "squash to dev", or wants to merge a feature branch into dev as a single commit
---

# Squash Merge to Dev

## Overview

将当前分支（或指定分支）的所有 commit 压缩为一个 commit，合并到 dev 分支。必须在 dev 分支所在的工作目录中执行。

## When to Use

- 用户说 "squash merge to dev"、"squash to dev"、"squash branch-name to dev" 等指令
- 用户在 feature 分支上完成开发，需要合并到 dev

## Steps

1. **确认 feature 分支并检查工作区状态**
   ```bash
   git branch --show-current
   git status
   ```
   如果用户指定了分支名，使用指定的分支。否则使用当前分支。
   如果工作区有未提交的更改，中止并提示用户先处理。

2. **查看待合并的 commit**
   ```bash
   git log --oneline dev..<branch>
   ```
   展示给用户，让用户确认范围正确。

3. **切换到 dev 并拉取远端更新**
   ```bash
   git checkout dev
   git pull
   ```
   如果 checkout 失败（worktree 中 dev 被其他工作目录占用），提示用户切换到 dev 所在的工作目录。

4. **将 dev 合并到 feature 分支**

   无论 pull 是否带来了新 commit，都需要将 dev 合并到 feature 分支。这确保 feature 分支包含 dev 的最新状态，同时也处理了用户在已 squash merge 过的 feature 分支上继续开发后再次合并的场景：
   ```bash
   git checkout <branch>
   git merge dev
   ```
   - **无冲突**：自动完成，继续下一步
   - **有冲突**：提示用户手动解决冲突，解决后 `git add` + `git commit` 完成合并，然后继续

5. **切换到 dev 执行 squash merge**
   ```bash
   git checkout dev
   git merge --squash <branch>
   ```

6. **生成 commit message**

   根据被 squash 的 commit 列表自动提炼 commit message：
   - 如果只有一个 commit，直接使用其 message
   - 如果有多个 commit，从各 commit 的前缀（feat/fix/chore）提炼主要变更，生成一条简洁的总结
   - 保持项目 commit 规范：使用 `feat:` / `fix:` / `chore:` 前缀

7. **提交并推送**
   ```bash
   git commit -m "<generated message>"
   git push
   ```
   如果 push 失败（远端 dev 有新 commit），执行：
   ```bash
   git pull --rebase
   git push
   ```

8. **展示结果并切回 feature 分支**

   显示新 commit 的 hash 和 message。
   ```bash
   git checkout <branch>
   ```

## Edge Cases

- **当前已在 dev**：正常流程，跳过 checkout
- **dev 被其他 worktree 占用**：提示用户切换到 dev 所在的工作目录执行
- **分支不存在**：报错并提示可用的分支
- **没有新 commit**：提示分支已经与 dev 同步，无需合并
- **有未提交的更改**：提示用户先处理工作区的更改
- **feature merge dev 时冲突**：暂停流程，等待用户解决冲突后再继续 squash merge

## Commit Message 生成规则

- 过滤掉 merge commit（包含 "Merge branch" 或有多个 parent 的 commit），只基于实际功能 commit 生成 message
- 单个 commit：直接复用原 message
- 多个同类型 commit（如都是 feat）：合并为 `feat: <summary>`
- 多个不同类型 commit：以主要变更类型为主，message 概括所有变更
- 如果 commit 已经很清晰，优先保持原始描述的简洁性
