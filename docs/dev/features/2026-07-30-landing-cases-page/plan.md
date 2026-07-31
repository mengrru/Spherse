# 实施计划 — Landing 案例页

## 1. 依赖与配置
- [ ] `packages/landing/package.json` 加 `react-router`（`^7`，与 app 同版本）。
- [ ] `packages/landing/src/vite-env.d.ts` 声明 `VITE_OSS_PUBLIC_BASE_URL?: string`。
- [ ] `.github/workflows/deploy-pages.yml` 的「Build landing」step 注入 `VITE_OSS_PUBLIC_BASE_URL: ${{ vars.OSS_PUBLIC_BASE_URL }}`。
- [ ] `npm install` 更新 lockfile。

## 2. 数据与工具
- [ ] `src/data/cases.ts`：`SampleCase[]`，3 项（carousel-2 / carousel-4 / carousel-2 轮换），`titleKey`/`descKey` 为 `TranslationKey`。
- [ ] `src/lib/sample.ts`：`sampleUrl(file): string | undefined`，读 `VITE_OSS_PUBLIC_BASE_URL`。

## 3. i18n
- [ ] 3 个 locale 文件加 `cases.*` key（pageTitle/subtitle/download/backHome + item1-3.title/desc），zh-CN 为基准，zh-TW/en 同步，文案占位。

## 4. 路由与页面
- [ ] `src/components/Header.tsx`：左字标（Link `/`）+ 右「案例」Link + LanguageSwitcher。
- [ ] `src/components/CasesPage.tsx`：标题区 + 卡片网格（响应式）+ 返回首页；卡片含截图/标题/说明/下载按钮（env 未配置则禁用）。
- [ ] `src/App.tsx`：`BrowserRouter` + `Routes`（`/` 现有内容、`/cases` CasesPage、`*` → Navigate `/`），用 Header 组件。
- [ ] `src/main.tsx`：render 前从 sessionStorage 还原路径（GH Pages 404 redirect-restore）。

## 5. GitHub Pages 404
- [ ] `packages/web/pages-assets/404.html`：保留 `/web*` 分支；其它路径存 sessionStorage 后 replace 到 `/`。

## 6. 验证
- [ ] `npm run build:landing`、`npm run lint --workspace=packages/landing`。
- [ ] dev 下手测：首页、跳 /cases、刷新。
