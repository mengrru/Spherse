# Web dev 环境(/dev/web)

## 背景

线上 web 端(PWA)只有 prod 环境:发版 tag 经 `build-and-release.yml` 级联触发 `deploy-pages.yml`(`include_web=true`),构建产物部署到 gh-pages 的 `/web/`,即 `https://spherse.mengru.work/web/`。dev 阶段的移动端 web 联调只能用 prod web 连 dev 桌面端,会被 version guard 的版本墙拦截(dev 分支 `app.getVersion()` 与线上 web 版本 major/minor 不一致)。

目标:

1. 新增 dev 环境 `https://spherse.mengru.work/dev/web/`,部署 dev 分支的 web 构建;
2. 本地 dev 客户端(`npm run dev`)的移动端扫码 deeplink 指向 dev 环境 web。

有利前提:web 构建产物路径无关(vite `base: "./"`,PWA `start_url`/`scope` 均相对),同一套构建代码无需改动即可部署到任意子路径。

## 设计

### D1. 部署链路:新增独立 workflow

新增 `.github/workflows/deploy-web-dev.yml`,与 `deploy-pages.yml` 分离,原因:

- GitHub Actions 的 `on.push.paths` 无法按 branch 区分。若在同一 workflow 合并 `branches: [main, dev]`,要么 main 失去 landing paths 过滤(每次 push 重建 landing),要么 dev 被 paths 约束(与「dev push 全量触发」的产品决策冲突)。
- 两者的部署语义不同:main/tag 部署是「发布」,dev 部署是「持续跟进」,触发与 keep_files 策略独立演化更清晰。

`deploy-web-dev.yml` 要点:

- 触发:`push: branches: [dev]`(无 paths 过滤,dev 分支任何 push 都重新部署)+ `workflow_dispatch`(手动,任意 ref,便于补部署 feature 分支构建)。
- `permissions: contents: write`(gh-pages push 需要)。
- 步骤:`npm ci` → `npm run build:web`(env `WEB_ENV=dev`,见 D5)→ stage:`pages-out/dev/web/` ← `packages/web/dist/`,同时拷 `404.html` 到 `pages-out/404.html`(携带 `/dev/web` 分支的 fallback;该文件极低频变更,dev 分支版本覆盖 main 版本无害)→ `peaceiris/actions-gh-pages@v4` `keep_files: true`(增量,不动 landing 与 `/web/`)。
- 不 build landing、不同步 tag 版本(dev web 版本号 = dev 分支 `packages/web/package.json`,见「版本墙」)。
- **并发控制**:两个 workflow 是同一 gh-pages 分支的两个 writer,peaceiris 为 force-push,并发时后推者基于旧 clone 覆盖先推者(如 landing 增量部署回退刚完成的发版全量部署)。两个 workflow 共享 `concurrency: group: pages-deploy` + `cancel-in-progress: false`(排队串行,不取消进行中的部署)。

`deploy-pages.yml` 改动 —— **发版全量部署保留 `dev/web`**:

- 现状 `include_web=true` 时 `keep_files: false`(全量覆盖,清除 pages-out 之外的远端文件)。加入 `dev/web` 后,每次发版都会把 dev 环境清掉。
- 修复:include_web 全量部署前,`git fetch origin gh-pages`,确认远端存在 `dev/web`(`git cat-file -e origin/gh-pages:dev/web` 守卫——首次部署 dev/web 尚不存在时 pathspec 检出会报错,需跳过),存在则检出复制进 `pages-out/dev/web`(发版产物 + 现有 dev/web 一起全量发布;dev/web 内容短暂落后于 dev 分支 HEAD 至下次 dev push,可接受)。
- landing-only 部署(main push)与 dev 部署均为 `keep_files: true`,配合共享 concurrency 串行后互不影响,其余不改。

### D2. 404.html SPA fallback

`packages/web/pages-assets/404.html` 在 `/web` 分支旁增加 `/dev/web` 分支:

```js
if (path === '/web' || path === '/web/' || path === '/dev/web' || path === '/dev/web/') {
  location.replace(path === '/dev/web' || path === '/dev/web/' ? '/dev/web/' : '/web/' + ...)
}
```

(实现时简化为:命中任一前缀则 redirect 到 `path.replace(/\/?$/, '/') + search + hash`。)该文件同时被两个 workflow 拷贝到 gh-pages 根。

### D3. 扫码 deeplink 指向 dev web

- `packages/app/src/lib/urls.ts`:`WEB_APP_URL` 按 `import.meta.env.MODE === "development"` 切换 —— development(electron-vite dev server,即 `npm run dev` 的本地 dev 客户端)→ `${SITE_ORIGIN}/dev/web/`;production(打包发版、web 壳构建)与 test(vitest `MODE=test`)→ `${SITE_ORIGIN}/web/`。不用 `import.meta.env.DEV`:vitest 默认环境下 `DEV` 实测为 `true`,会挂掉现存 prod URL 断言。
- 唯一消费方是 `MobileAccessPanel.tsx` 的 `buildDeeplink`(quick/manual 两模式共用),web 壳 `capabilities.mobileAccess: false` 不会消费该常量,切换无副作用。
- **类型声明内联在 `urls.ts`**(`interface ImportMeta { env: ImportMetaEnv }` + `interface ImportMetaEnv { MODE: string }`),不新建 `vite-env.d.ts`:packages/app 的 exports 直指源码,`packages/web` 与 `packages/desktop` 的 typecheck program(include 各自仅 `src`)会经 import 图加载 `urls.ts`,独立 d.ts 文件不在对方 include 中会被跳过,导致 `import.meta.env` TS2339;内联声明随模块对所有 program 可见。
- `urls.test.ts`:默认(MODE=test)断言 prod URL;`vi.stubEnv("MODE", "development")` + `vi.resetModules()` 动态 re-import 断言 dev URL(常量在模块加载时求值,stubEnv 单独不生效)。

不采用 bridge 运行时下发(主进程 `app.isPackaged`):需扩 IPC contract 与 `MobileAccessState`,而「本地 dev 客户端」在本仓库的运行形态就是 electron-vite dev,构建期判定已准确覆盖,改动面最小。### D4. web 壳 localStorage 隔离

`/web/` 与 `/dev/web/` 同 origin(`https://spherse.mengru.work`),localStorage 按 origin 共享。若不隔离:

- 手机在 dev web 扫码连接(dev 桌面端 base/token)会覆盖 `spherse:connection`,之后打开 prod web 恢复的是 dev 桌面端连接(大概率被版本墙拦或连接失败),反之亦然;
- `spherse:last-active-project` 的 project id 属于不同桌面端实例,互相恢复 404;
- `spherse:settings` 混入不同环境偏好。

方案:`packages/web/src/host-bridge-web.tsx` 模块内按 `location.pathname` 以 `/dev/web` 开头判定 dev 部署,三个 key(`spherse:connection` / `spherse:settings` / `spherse:last-active-project`)统一加 `:dev` 后缀。`WEB_CONNECTION_STORAGE_KEY` 保持字符串常量导出(值随部署环境变化),`version-block-overlay.tsx`(忘记连接)与 `MobileConnectPage.tsx`(写入连接)零改动。

`packages/app` 内部的 UI 状态 key(`spherse:tabs`、`spherse:content-split`、草稿等)按 project/session id 键控,跨环境共享只是无害冗余,不隔离。

### D5. PWA Dev 标识

dev 构建的 manifest `name`/`short_name`/`description` 加 "Dev" 标识,手机桌面可区分:

- `packages/web/vite.config.ts` 读 `process.env.WEB_ENV === "dev"`(vite config 运行于 Node,无需 define 中转),命中时 manifest 字段加后缀(如 `Spherse Dev` / `Spherse Dev (dev branch build)`),并经 `transformIndexHtml` 把 `<title>` 改为带 Dev 标识——iOS Safari 添加到主屏的标签取 HTML title / `apple-mobile-web-app-title`,不吃 manifest name,只改 manifest 时 iOS 桌面无法区分。
- 仅 `deploy-web-dev.yml` 注入 `WEB_ENV=dev`;`deploy-pages.yml` 的 prod 构建不注入,行为不变。
- manifest `id`/`start_url`/`scope` 由相对路径解析(`/dev/web/`),与 prod PWA 天然是两个安装项;图标不变(以名称区分,避免新增图标资产);`manifest.webmanifest` 不在 workbox precache globPatterns 内,改 manifest 不触碰 SW。

### 版本墙(dev 桌面端 × dev web)

dev 桌面端 `app.getVersion()` = dev 分支 `packages/desktop/package.json` 版本(当前 `0.1.0`,CI 发版时才临时同步 tag 版本、不回写仓库);dev web `__SPHERSE_WEB_VERSION__` = dev 分支 `packages/web/package.json` 版本(当前同为 `0.1.0`)。两者一致 → `compareAppVersion` = `ok`。

约束:dev 分支上两个 package.json 的 version 需保持 major/minor 同步,漂移会触发版本墙(有「暂不升级,继续使用」可跳过,单会话生效)。当前均 `0.1.0` 且无 CI 同步,风险可控。

## 已知取舍

- **发版时 dev/web 短暂回退**:include_web 全量部署携带的是 gh-pages 上的既有 dev/web(可能落后 dev HEAD),直到下一次 dev push 追平。不做「发版时从 dev 分支重建 dev web」——发版流水线应只关心发版产物,跨 ref 构建增加耦合。
- **dev web 版本号不随发版演进**:dev 环境部署的是 dev 分支代码,版本号语义就是「分支当前版本」,与 prod(= tag 版本)语义不同,合理。
- **404.html 可能被 dev 分支版本覆盖**:低频文件且改动向后兼容(只增分支),接受。
- **dev push 全量触发**(用户决策):文档-only push 也跑一次 build + 部署,CI 消耗换逻辑简单。
- **dev/web 的 content-hash 资产只增不减**:`keep_files: true` 增量部署下,每次 dev push 新 hash 的 js/css 叠加在 gh-pages 分支,分支体积缓慢增长(workbox `cleanupOutdatedCaches` 只清客户端旧 cache,不清分支文件)。接受;若未来成为问题,可定期手动 `force_orphan` 全量重部署。

## 文件变更清单

| 文件 | 变更 |
|---|---|
| `.github/workflows/deploy-web-dev.yml`(新) | dev push / 手动触发,构建 web(WEB_ENV=dev)部署到 gh-pages `dev/web/`;共享 `concurrency: pages-deploy` |
| `.github/workflows/deploy-pages.yml` | include_web 全量部署前从 gh-pages 恢复 `dev/web` 进 pages-out(存在性守卫);共享 `concurrency: pages-deploy` |
| `packages/web/pages-assets/404.html` | 增加 `/dev/web` SPA fallback 分支 |
| `packages/app/src/lib/urls.ts` | `WEB_APP_URL` 按 `import.meta.env.MODE === "development"` 切换 prod/dev;内联 ImportMeta 类型声明 |
| `packages/app/src/lib/urls.test.ts` | prod/dev 两个环境断言(stubEnv + resetModules) |
| `packages/web/src/host-bridge-web.tsx` | 三个 localStorage key 按部署路径加 `:dev` 后缀 |
| `packages/web/vite.config.ts` | `WEB_ENV=dev` 时 manifest 与 HTML title 加 Dev 标识 |
| `docs/official/project-structure.md` | web 部署路径、404、workflow 职责 |
| `docs/official/architecture/desktop.md` | deeplink 格式补 dev 环境 |
| `docs/official/architecture/frontend.md` | 连接 storage key 的环境隔离说明 |

## 验证

- `packages/app` 单测:urls prod/dev 断言;`npm run verify`。
- 本地构建两次 web(`WEB_ENV=dev` 与默认),diff `dist/manifest.webmanifest` 确认标识差异;确认产物相对路径不变。
- workflow 语法检查(actionlint 或 `gh workflow view` 干跑);dev push 后检查 gh-pages `dev/web/` 内容与 `/dev/web/` 可访问、404 fallback 生效。
- 手动:`npm run dev` 起 dev 客户端,确认二维码 URL 为 `/dev/web/#/?base=...&token=...`;手机扫码连接、断开(忘记连接)、再连 prod web,确认两边连接互不覆盖(localStorage 隔离)。
- 发版演练:手动 `workflow_dispatch` `include_web=true`,确认部署后 `dev/web/` 仍在。
