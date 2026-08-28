# Landing Download 页面 + Release Changelog 链路

- 日期：2026-08-28
- 状态：Implemented（2026-08-28，75da4d1 + review 反馈 0a1d3fd）
- 关联：`docs/dev/infra/2026-07-27-release-oss-mirror/design.md`（OSS 镜像与 latest.json）、`docs/dev/infra/2026-08-17-app-update-oss-source/design.md`（OSS 清单消费方）、`.agents/skills/release-new-version/SKILL.md`（发版流程）

## 背景

Landing page 首页 Hero 只有按平台自动检测的下载按钮，用户无法：

1. 看到**所有平台**（mac arm64/intel、win x64/arm64）的下载入口——非主流平台的用户只能去 GitHub Releases 自己找；
2. 了解**版本更新历史**——GitHub Release notes 存在（`gh release create --generate-notes` 自动生成），但国内访问困难，且没有任何站内展示。

现有资产：

- CI `publish-oss` job 每次发版将安装包上传 OSS 并维护 `spherse/latest.json`（`{version, mac:{arm64,intel}, win:{x64,arm64}}`），landing 已消费（`packages/landing/src/lib/release.ts`）；
- GitHub Release notes 由 `--generate-notes` 生成，格式稳定：

  ```
  ## What's Changed
  * feat: 支持载入 .agents/skills by @mengrru in https://github.com/mengrru/Spherse/pull/40
  * chore: 启用全包 typecheck 并清零现有类型错误 by @mengrru in https://github.com/mengrru/Spherse/pull/41
  ...
  **Full Changelog**: https://github.com/mengrru/Spherse/compare/v0.3.0...v0.3.1
  ```

  存在 `## New Contributors` 小节的可能（新增贡献者时），条目非 changelog 语义。

需求：landing 新增 `/download` 页面，列出最新版本各平台下载入口 + 展示 changelog；changelog 在发版时从 GitHub 自动 notes 提炼（筛掉 `docs`/`chore`/`infra`、去掉 PR 链接），存入 OSS `spherse/changelog.json`，landing 运行时读取，从新到旧展示。

## 方案

### 已确认决策

| 决策点 | 结论 |
|---|---|
| changelog 生成策略 | **全量重建**：每次从 GitHub API 拉取全部 release 重新生成整个 changelog.json。幂等可自愈，筛选规则变更后重跑即全量生效，OSS 文件丢失可恢复 |
| 条目清理 | 去掉 PR 链接**和作者**：`feat: xxx by @mengrru in https://…/pull/40` → `{type: "feat", text: "xxx"}`（结构化条目，CI 单点解析类型，前端零解析直接渲染徽章）。类型仅白名单（feat/fix/refactor/test/perf/style）结构化，其余前缀（如 `Note:`）归为无类型纯文本；裸 ` in <url>` 尾部仅剥 github.com 域名链接，避免误截正文自带链接 |
| 空版本处理 | **过滤**：筛完后 notes 为空的 release 不写入 changelog.json（真实数据核查：现有 25 个 release 中 16 个无 `## What's Changed` 内容、仅 9 个有效，避免页面被空面板稀释） |
| 失败策略 | `deploy-web` 等待 `publish-changelog` 完成，changelog 上传失败阻塞 Pages 部署，失败显性化 |
| 展示形式 | 每版本一个折叠面板，最新版默认展开，其余折叠 |

### CI：`publish-changelog` job（`build-and-release.yml`）

新 job 串行在 `publish-oss` 之后执行（不发并行）：`latest.json` 更新完成后才写入新版本 changelog，避免发版期间或 build 失败后 OSS 上 changelog 首条与 latest.json 版本不一致。流程：

```
gh api（分页拉全量 releases）→ 纯函数变换（scripts/build-changelog.mjs）→ ossutil 上传 spherse/changelog.json
```

```yaml
publish-changelog:
  needs: publish-oss
  # tag push 与 workflow_dispatch 重发布都执行（publish-oss 两条路径都运行）：
  # 全量重建幂等，dispatch 重跑可修复/刷新历史
  if: always() && needs.publish-oss.result == 'success'
  steps:
    - checkout（取 scripts/build-changelog.mjs）
    - setup-node 22.19
    - node scripts/build-changelog.mjs --repo "$GITHUB_REPOSITORY" --output /tmp/changelog.json
      env: GH_TOKEN（读 releases API）
    - 安装 ossutil（复用 publish-oss 的 curl 步骤）
    - 上传 oss://${OSS_BUCKET}/spherse/changelog.json（--force -u）
```

`deploy-web` 改为：

```yaml
deploy-web:
  needs: [publish-oss, publish-changelog]
  if: github.event_name == 'push' &&
      needs.publish-oss.result == 'success' &&
      needs.publish-changelog.result == 'success'
```

（workflow_dispatch 路径 deploy-web 本就不执行，行为不变。）

### 生成脚本：`scripts/build-changelog.mjs`

与 `rebuild-native.mjs` 同级的仓库级 CI 脚本，**零依赖纯 Node**（Node 22 原生 fetch），两部分：

1. **拉取**：`GET /repos/{repo}/releases?per_page=100&page=N` 循环翻页（以响应 `Link: rel="next"` header 为终止条件，避免总数恰为整数倍时提前截断），`GH_TOKEN` 鉴权；
2. **纯函数变换**（export，供测试）：

```
transformReleases(releases):
  1. 过滤 draft / prerelease
  2. 按 tag 语义化版本降序（去 v 前缀，数字段比较；非法 tag 排最后）
  3. 每个 release body：
     a. 只取「## What's Changed」小节（按 ## 标题切分；New Contributors、Full Changelog 等其余小节全部丢弃）
     b. 取 `* ` 开头的条目行
     c. 解析类型前缀：`^([A-Za-z]+)[：:]\s*` → type（小写化）；命中 docs / chore / infra 的条目丢弃（兼容全角冒号，如既有 commit `feat：xxx`）；仅白名单类型（feat/fix/refactor/test/perf/style）结构化并剥前缀，其余前缀不剥、条目整体作为纯文本
     d. 去尾部：` by @user in <url>` 优先，兜底 ` in https://github.com/…`（仅 github.com 域，防误截正文链接）；trim，得到 text
     e. 条目结构化为 {type, text}（无前缀条目 type 为 null）
  4. date 取 published_at 的日期部分；tag 保留原始 tag_name（前端版本外链直接用，不假设 v 前缀）
  5. 筛完后 notes 为空的 release 丢弃（见决策表「空版本处理」）
```

CLI：`node scripts/build-changelog.mjs --repo owner/name --output <file>`（缺省输出 stdout），非 2xx / JSON 非法直接 exit 1 让 job 红。

### OSS 产物：`spherse/changelog.json`

```json
{
  "generatedAt": "2026-08-28T10:00:00Z",
  "releases": [
    {
      "version": "0.3.1",
      "tag": "v0.3.1",
      "date": "2026-08-28",
      "notes": [
        { "type": "feat", "text": "支持载入 .agents/skills" },
        { "type": "fix", "text": "项目打开失败不再静默覆盖项目文件" }
      ]
    }
  ]
}
```

`type` 为条目类型前缀小写（`feat` / `fix` / `refactor` / …），无前缀条目为 `null`。

公开 URL：`${OSS_PUBLIC_BASE_URL}/spherse/changelog.json`，landing 复用已注入的 `VITE_OSS_PUBLIC_BASE_URL`，**无需新增构建 env**。

### Landing：`/download` 页面

**数据获取（`src/lib/`）**：

- `release.ts`：导出 `fetchLatestManifest()`（现为私有）、`export type { Manifest }` 与 `FALLBACK_URL`——下载区与 GitHub 兜底卡复用，不再新增硬编码 URL；
- 新增 `changelog.ts`：`Changelog` 类型（与上述 schema 对齐）+ `fetchChangelog()`（`fetch(VITE_OSS_PUBLIC_BASE_URL + "/spherse/changelog.json")`，失败/非 200/JSON 非法 throw，**由页面 catch 隐藏区块**——注意与 release.ts 函数内吞错返回 fallback 是两种不同模式，不照抄）。

**`src/components/DownloadPage.tsx`**（参考 `CasesPage`/`DocsPage` 的 props 传 `t` 模式）：

- 下载区：fetch `latest.json` → 版本号 + 4 张平台卡片（macOS Apple Silicon / macOS Intel / Windows x64 / Windows ARM64），直接 `href` 到 manifest URL；manifest fetch 失败**或平台 URL 全空** → 单卡兜底 GitHub Releases 链接（复用 `FALLBACK_URL`）；卡片下方按涉及平台复用 `InstallTip`（Gatekeeper/SmartScreen 安装提示，与 Hero 体验一致）；
- 更新日志区：fetch changelog.json → 每版本折叠面板（最新默认展开），条目按 `type` 字段渲染徽章（feat 绿 / fix 琥珀 / 其他中性 / null 纯文本，零解析），版本标题右侧外链 `https://github.com/mengrru/Spherse/releases/tag/{tag}`（schema 直存 tag）。

**路由与导航**：`App.tsx` 加 `<Route path="/download">`；`Header.tsx` 在 Explore 与语言切换之间加 `nav.download` 链接。GitHub Pages 404.html 深链回退机制自动覆盖新路由，无需改动。

### 变更面

| 文件 | 变更 |
|---|---|
| `.github/workflows/build-and-release.yml` | 新增 `publish-changelog` job；`deploy-web` needs 加 `publish-changelog` |
| `scripts/build-changelog.mjs` | 新增：拉取 + 纯函数变换 + CLI |
| `packages/desktop/release-pipeline.test.ts` | 更新 deploy-web needs 断言；新增 publish-changelog job 结构断言（needs publish-oss、publish-oss 成功才执行、上传路径 spherse/changelog.json） |
| `packages/desktop/changelog-generator.test.ts` | 新增：纯函数变换测试（见测试策略） |
| `packages/landing/src/lib/release.ts` | 导出 `fetchLatestManifest`、`export type { Manifest }`、`FALLBACK_URL` |
| `packages/landing/src/lib/changelog.ts`（+ `.test.ts`） | 新增：`Changelog` 类型 + `fetchChangelog()`（零类型解析，结构化 schema） |
| `packages/landing/src/components/DownloadPage.tsx` | 新增：页面组件 |
| `packages/landing/src/App.tsx` / `components/Header.tsx` | 路由 + 导航链接 |
| `packages/landing/src/i18n/locales/{zh-CN,en,zh-TW}.ts` | `nav.download` + `download.*` 三语 |
| 文档同步（doc-sync） | `docs/official/project-structure.md`（新增文件 + CI 职责描述）、`docs/official/architecture/desktop.md`（CI 链路加 publish-changelog）、`.agents/skills/release-new-version/SKILL.md`（CI 自动上传 changelog + dispatch 重建的自愈手段） |

不改动：`deploy-pages.yml`（env 已够用）、Hero 下载按钮、desktop updater、OSS `latest.json` 链路。

## 测试策略

**`packages/desktop/changelog-generator.test.ts`**（import 根脚本导出的纯函数 + mock fetch）：

1. 筛掉 `docs:` / `chore:` / `infra:`，保留 `feat:` / `fix:` / `refactor:` 等其他类型；
2. 全角冒号 `chore：xxx` 同样被筛掉；类型结构化（`{type, text}`，无前缀 type 为 null）；
3. ` by @user in <url>` 与裸 ` in <url>` 尾部均去除；
4. `## New Contributors` 小节与 `**Full Changelog**` 行不进入结果；
5. 语义化版本降序（含跳号：0.1.19 < 0.2.0；v 前缀去除；多段版本比较）；
6. draft / prerelease 被跳过；
7. 筛完后 notes 为空的 release 被丢弃（不入输出）；
8. body 缺失 / 无 What's Changed 小节 → notes 空、不抛错；
9. date 取 published_at 日期部分；tag 保留原始 tag_name；
10. 拉取层：mock fetch 带 `Link: rel="next"` header 的两页翻页后合并、无 next header 即止。

**`packages/desktop/release-pipeline.test.ts` 更新**：

- deploy-web：needs 为 `[publish-oss, publish-changelog]`，条件含两个 `result == 'success'`；
- publish-changelog：`needs: publish-oss`、`always() && needs.publish-oss.result == 'success'` 条件、执行 `scripts/build-changelog.mjs`、上传目标含 `spherse/changelog.json`。

**`packages/landing/src/lib/changelog.test.ts`**（照抄 `release.test.ts` 的 stubGlobal fetch 范式）：

- fetch 成功解析 releases（结构化 type/text）；
- fetch 失败 / 非 200 / JSON 非法 → throw（页面隐藏区块）。

回归：`npm run verify`。

## 风险

- **GitHub auto-notes 格式变更**：解析锚定「## What's Changed」+ `* ` 条目行，这两个是 generate-notes 多年稳定格式；格式漂移时该版本退化为空 notes、被过滤（不 crash、不阻塞发版主链路——publish-changelog 失败会阻塞 deploy-web，被显式选择，见决策表）。
- **国内拉 GitHub API 慢/失败**：生成在 GitHub Actions runner（海外）上执行，不受国内网络影响；landing 只读 OSS。
- **全量重建的 API 消耗**：release 数几十量级，单次 1–2 个 API 调用，可忽略。
- **首次运行前 OSS 无 changelog.json**：landing 页 changelog 区块 fetch 404 → 隐藏区块 + 保留下载区，页面不残废；随下次发版自动生成全量历史。也可手动 dispatch 一次 workflow 立即生成（自愈手段，已列入 SKILL.md 同步项）。
- **浏览器缓存 changelog.json**：与现有 latest.json 同源同行为（无 cache-busting），接受；OSS 侧默认缓存策略一致。
- **changelog.json 体积**：当前有 notes 的版本 9 个、单版本最多 ~14 条，全量 ≈ 10 KB 量级，可忽略。
