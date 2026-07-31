# Landing 案例页（/cases）

## 背景

落地页目前是单页滚动、无路由。需要新增一个独立的「案例」页面，展示若干 sample project，提供截图、说明文字与下载链接（阿里云 OSS zip）。本次截图/文案/zip 全部为占位，后续替换。

## 目标

- 新增 `/cases` 独立路由页面。
- 3 张占位卡片：轮换使用 `screenshots/carousel-2.png` / `carousel-4.png`，文案占位，下载 zip 文件名占位。
- 顶部导航新增「案例」入口；案例页可返回首页。
- 下载链接指向 `${OSS_PUBLIC_BASE_URL}/spherse/sample/<file>.zip`，base url 与 release 下载同源（GitHub 仓库变量 `vars.OSS_PUBLIC_BASE_URL`）。

## 非目标

- 真实截图 / 文案 / zip 上传（本次全占位）。
- 与现有 `UseCasesModal`（FeatureCards 里「更多使用案例」弹窗，文本用例）无关，不改动它。
- sample zip 实际上传到 OSS 的 CI 步骤（后续单独做）。

## 设计

### 路由

- 引入 `react-router`（与 app 同包同版本 `^7`）。`App.tsx` 用 `BrowserRouter` 包裹：
  - `/` → 现有落地页内容（Hero / Carousel / FeatureCards / UpcomingFeatures）
  - `/cases` → 新 `CasesPage`
  - `*` → `Navigate` 回 `/`
- Header 升级为独立组件：左侧 Spherse 字标（Link 回 `/`），右侧「案例」链接 + `LanguageSwitcher`。两个路由共用 header/footer。

### CasesPage

- 数据 `src/data/cases.ts`：`SampleCase[]`，3 项，每项 `{ id, screenshot, titleKey, descKey, zipFile }`。`titleKey`/`descKey` 为 landing `TranslationKey`（类型安全，镜像 `use-cases.ts` 的 `i18nKey` 模式）。
- 截图轮换 `carousel-2.png` / `carousel-4.png`。
- 页面结构：标题区（「案例」+ 副标题）+ 卡片网格（响应式 1/2/3 列）+ 返回首页链接。
- 卡片：截图 + 标题 + 说明 + 「下载示例项目」按钮（`target=_blank`，`rel=noopener`）。

### 下载链接（OSS）

- `deploy-pages.yml` 注入 `VITE_OSS_PUBLIC_BASE_URL: ${{ vars.OSS_PUBLIC_BASE_URL }}`（与现有 `VITE_OSS_MANIFEST_URL` 同源同位置）。
- `src/vite-env.d.ts` 声明 `readonly VITE_OSS_PUBLIC_BASE_URL?: string`。
- `src/lib/sample.ts`：`sampleUrl(file) = BASE ? \`${BASE}/spherse/sample/${file}\` : undefined`。env 未配置时下载按钮禁用。

### GitHub Pages 直链/刷新（redirect-restore）

`/cases` 直接访问或刷新会触发 GH Pages 404，现有 `404.html` 会把任意非 `/web` 路径 `replace` 到 `/`，丢失路径。小改 `packages/web/pages-assets/404.html`（与 web 共享，保持 `/web*` 分支不变）：

- `/web*` → 仍 `replace` 到 `/web/`（web 行为不变）。
- 其它路径 → 把 `path + search + hash` 存入 `sessionStorage['spherse-landing-redirect']`，再 `replace` 到 `/`。
- landing `main.tsx` 在 `createRoot` 前：若 sessionStorage 有 redirect，`history.replaceState` 还原原路径，再交给 router 渲染。未知路径由 `<Route path="*">` 回 `/` 兜底。

### i18n

landing 本地 i18n（`src/i18n/locales/{zh-CN,zh-TW,en}.ts`），新增 `cases.*` 系列 key（页面标题/副标题/下载按钮/返回首页/3 张卡片的标题与说明），三语同步，zh-CN 为基准。文案占位。

## 影响面

- 新增：`data/cases.ts`、`lib/sample.ts`、`components/CasesPage.tsx`、`components/Header.tsx`。
- 修改：`App.tsx`（路由化）、`main.tsx`（path-restore）、3 个 locale 文件、`vite-env.d.ts`、`package.json`（+react-router）、`packages/web/pages-assets/404.html`、`.github/workflows/deploy-pages.yml`。

## 验证

- `npm run build:landing` 通过；`npm run lint --workspace=packages/landing` 0 errors。
- 本地 `npm run dev:landing`：首页正常、点「案例」跳 `/cases`、刷新 `/cases` 不丢失（需构建后用 preview 验证 404 路径，dev 下 Vite 自带 SPA 回退）。
