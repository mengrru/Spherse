---
description: Create a new branch from origin/dev, then start the task
---

先从最新 origin/dev 新建一个随机名分支（git fetch origin dev && git checkout -b <branch> origin/dev），工作区不干净时停止并告知用户；然后开始任务：

$ARGUMENTS
