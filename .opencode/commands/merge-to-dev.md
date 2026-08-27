---
description: Commit all changes and merge current branch to dev
---

Commit all current changes, then merge the current branch to dev (no squash, preserve commit history):

1. git status + git diff to see changes, git log to check commit style
2. git add and commit with appropriate message
3. git checkout dev && git pull
4. git merge <current-branch> && git push
5. git checkout <current-branch>（切回原分支）
