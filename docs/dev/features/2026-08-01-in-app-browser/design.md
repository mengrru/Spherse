# In-App Local-Page Browser

## Summary

Add a second way to open external pages: an in-app **simple browser** that renders local-served web pages (e.g. `http://localhost:3000`) inside the app. The browser supports both **page-level** (full-page route) and **floating-window-level** display, mirroring the `floating-content-browser` architecture. Loopback links clicked in chat/content are auto-intercepted into the in-app browser; all other links keep the existing "open in system browser" behavior. Rendering uses a plain `<iframe>` (no server proxy) — local-only for now; a server-side reverse proxy for remote (tunnel) access is deferred to a follow-up feature.

## Requirements

1. Clicking an **http(s) loopback link** (`localhost` / `127.0.0.1` / `::1`) in chat markdown, content-view markdown, or an agent HTML card opens it in the in-app simple browser instead of the system browser. Non-loopback links fall through to the existing `bridge.openExternal` (system browser).
2. The browser opens **as a floating window by default**; the user can "expand" to page-level. From page-level the user can "collapse" back to a floating window.
3. **Multi-window floating**: multiple distinct loopback URLs can be open at once, each in its own floating window. The same URL reuses its existing window (no duplicates).
4. New floating windows are cascade-positioned (stair-step offset), reusing the shared `FloatingFrame`.
5. The simple browser toolbar provides: **editable address bar** (enter + Enter navigates), **refresh**, **open in system browser**, and **page/float toggle**. No back/forward, no copy-URL.
6. The address bar only accepts loopback URLs; entering a non-loopback URL shows a toast ("仅支持本地页面") and does not navigate.
7. Page rendering uses `<iframe>` with `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"` (excludes `allow-top-navigation` so a local page cannot hijack the top app window via `window.top.location`).
8. Feature is Electron-only (`browser` feature gate, `ELECTRON_ONLY`).
9. Floating state (open URLs + position/size per project) persists across app restarts.
10. Closing a project clears that project's browser floating windows.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Rendering technology | `<iframe>` | User scoped this to "简易浏览器" + "仅 local served page"; local dev servers (Vite/CRA/Next) are generally frameable; zero main-process changes; consistent with existing preview-URL iframe pattern (`ContentView.tsx:90`). `<webview>`/`BrowserView` are overkill. |
| Entry point | Auto-intercept loopback link clicks | User choice; deterministic rule (loopback → app, else → system), no settings toggle needed. |
| "Local" definition | loopback only (`localhost`/`127.0.0.1`/`::1`) | User choice; tightest scope; private-LAN ranges excluded for v1. |
| Default open mode | Floating window | Least disruptive — keeps the user in their chat/content context; expand available. |
| Multi-window model | One float per URL, keyed by URL | Mirrors `floating-content-browser` (one float per file); reuses the exact store shape with `url` as key. |
| Interception centralization | Shared `useOpenExternalLink()` hook + one pure `isLoopbackUrl`/`openExternalUrl` module | Single source of truth for the routing rule; 3 call sites reuse it; testable without React. |
| Remote (tunnel) support | **Out of scope for v1** — direct iframe only | A server reverse proxy is required for remote (an iframe's `localhost` resolves to the remote client, not the host). Proxy adds real complexity (asset/base rewriting, HMR/WebSocket, header stripping). Deferred to a follow-up feature. |
| iframe sandbox | `allow-scripts allow-same-origin allow-forms allow-popups` (no `allow-top-navigation`) | Lets the local dev page run normally (storage, forms, popups) while preventing top-window hijack. `allow-same-origin` preserves the page's origin/storage. |
| Address-bar URL tracking | Shows the URL we navigated to; intra-page navigation is NOT tracked | Cross-origin (different port) iframes block reading `contentWindow.location`. Acceptable for a simple browser; refresh reloads the entered URL. |

## Architecture

### Feature Layout

```
packages/app/src/features/browser/
├── store.ts                      # Zustand, multi-window per-URL, per-project, persisted
├── BrowserManager.tsx            # renders one container per open window
├── FloatingBrowserContainer.tsx  # portal + FloatingFrame(hookPrefix="browser") + Toolbar + View
├── BrowserToolbar.tsx            # address bar + refresh + open-in-system-browser
├── BrowserView.tsx               # iframe (shared by float + page-level)
├── BrowserPageView.tsx           # full-page wrapper: toolbar + view + collapse-to-float
├── defaults.ts                   # FLOAT_DEFAULT_WIDTH/HEIGHT, CASCADE_*
├── open-external-url.ts          # isLoopbackUrl + openExternalUrl + useOpenExternalLink hook
├── use-browsed-urls.ts           # selector hook: useBrowsedUrls(projectId): Set<string>
└── index.ts                      # barrel

packages/app/src/pages/BrowserPage.tsx   # route adapter (reads ?url=)
```

### State Management

New feature-local Zustand store `features/browser/store.ts` — clones `floating-content-browser/store.ts` with `url` as the key:

```typescript
export interface BrowserWindow {
  url: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

interface BrowserStore {
  byProject: Record<string, Record<string, BrowserWindow>>;
  openFloat: (projectId: string, url: string) => void;   // cascade-positioned; no-op if exists
  closeFloat: (projectId: string, url: string) => void;
  setPosition: (projectId: string, url: string, pos: { x: number; y: number }) => void;
  setSize: (projectId: string, url: string, size: { width: number; height: number }, pos: { x: number; y: number }) => void;
  clearProject: (projectId: string) => void;
}
```

- **`openFloat`**: if `byProject[projectId][url]` exists → no-op. Otherwise compute cascade position from current window count and insert.
- **Persistence**: single key `spherse:floating-browser` storing the whole `byProject` blob. Hydrated on store creation (read once). Write-through on every mutation.
- **Cascade**: `offset = (existingCount % CASCADE_WRAP) * CASCADE_STEP`; bottom-right anchored via shared `getDefaultPosition`.

### Interception (Centralized Routing)

`features/browser/open-external-url.ts`:

```typescript
export function isLoopbackUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1";
  } catch {
    return false;
  }
}

// Pure, testable: decides in-app float vs system browser.
export function openExternalUrl(
  url: string,
  opts: { projectId: string; hostKind: HostKind; openExternal: (u: string) => Promise<void> },
): void {
  if (isFeatureEnabled("browser", opts.hostKind) && isLoopbackUrl(url)) {
    useBrowserStore.getState().openFloat(opts.projectId, url);
    return;
  }
  void opts.openExternal(url);
}

// React hook for the 2 markdown link-click call sites.
export function useOpenExternalLink(): (url: string) => void {
  const bridge = useHostBridge();
  const { projectId } = useProjectCtx();
  return useCallback(
    (url: string) => openExternalUrl(url, { projectId, hostKind: bridge.kind, openExternal: bridge.openExternal }),
    [bridge.kind, bridge.openExternal, projectId],
  );
}
```

**3 interception points** reuse this:

1. `MessageItem.handleLinkClick` (`features/chat/MessageItem.tsx`) — replace `await bridge.openExternal(href)` with `openLink(href)` (hook result).
2. `ContentView.handleLinkClick` (`features/content-browser/ContentView.tsx`) — same replacement.
3. `openExternalLink` ui-sdk handler (`ui-sdk/handlers/open-external-link.ts`) — call `openExternalUrl` with the action `ctx` (which already carries `projectId`, `hostKind`, `openExternal`). Keeps agent-HTML-card loopback links consistent.

The explicit settings buttons (DeepSeek/GitHub releases/Cloudflare docs) are never loopback → unchanged.

### Page-Level Route

New child route in `router.tsx`:

```
project/:projectId/browser?url=<encoded>
```

- `pages/BrowserPage.tsx` reads `url` from `useSearchParams`. If `url` is missing or not loopback → `navigate(/project/:projectId, { replace: true })` and return null.
- Renders `BrowserPageView` (full-page toolbar + view). The "collapse to float" button calls `openFloat(projectId, url)` then navigates back (project root or history back).

### Component Hierarchy

```
ProjectScope
├── <Outlet /> (main content; includes /browser route)
├── <FloatingChatManager />                 (existing)
├── <FloatingContentBrowserManager />       (existing)
└── <FeatureGate feature="browser">
    └── <BrowserManager />
        └── for each window in byProject[projectId]:
            createPortal(document.body)
              └── FloatingBrowserContainer
                    ├── FloatingFrame (hookPrefix="browser")
                    │   ├── TitleBar (host + close + expand-to-page on dblclick)
                    │   └── BrowserToolbar + BrowserView
                    └── onExpand → closeFloat + navigate(/browser?url=)
```

**`FloatingBrowserContainer`**:
- `createPortal(..., document.body)`.
- `FloatingFrame` with `hookPrefix="browser"`, title = `<host>:<port>` (derived from URL).
- Body = `BrowserToolbar` + `BrowserView`.
- `onExpand` (also fires on titlebar double-click via `FloatingFrame`): `closeFloat` + `navigate(/project/:id/browser?url=<encoded>)`.

**`BrowserToolbar`** (shared by float + page):
- Editable address bar (`<input>`): shows current URL; Enter → if `isLoopbackUrl(value)` navigate iframe, else toast and revert.
- Refresh button: bumps a `refreshKey` to force iframe remount.
- "Open in system browser" button: `bridge.openExternal(url)`.
- Page/float toggle handled by `FloatingFrame.onExpand` (float→page) and `BrowserPageView`'s collapse button (page→float).

**`BrowserView`** (shared by float + page):
- `<iframe key={refreshKey} src={url} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />`.
- Loading + error overlay not strictly needed (cross-origin blocks read); rely on iframe native behavior.

### Decoupling: Selector Hook

- `useBrowsedUrls(projectId): Set<string>` — thin read-only selector exported from the feature, mirrors `useFloatedFilePaths`. (Kept for parity/future use even though v1 has no file-tree-style toggle UI.)

### Theme Integration

New customizable selectors (parallel to `data-chat-float-*` / `data-content-float-*`):

| Selector | Description |
|---|---|
| `[data-browser-float-root]` | Floating browser window outermost container |
| `[data-browser-float-titlebar]` | Title bar (host + buttons) |
| `[data-browser-float-close]` | Close button |

- Update `packages/presets/skills/create-ui-theme/` to document the new selectors (per AGENTS.md, must sync skill docs when adding themeable float hooks).
- Colors use global theme tokens only (portal rule).

### Feature Gate, Mounting, Cleanup

- Register `"browser": ELECTRON_ONLY` in `lib/feature-registry.ts`.
- Mount `<FeatureGate feature="browser"><BrowserManager /></FeatureGate>` in `layouts/ProjectScope.tsx` next to the existing two managers.
- Wire `clearBrowser(projectId)` into `use-project-actions.ts` `handleCloseProject` (parallel to the content-browser clear).

### i18n

Add to a `browser` namespace (zh-CN baseline with UI-context comments, plus zh-TW + en):

- `browser.addressPlaceholder` — address bar placeholder ("输入本地页面地址…").
- `browser.refresh` — refresh button tooltip ("刷新").
- `browser.openInSystemBrowser` — open-in-system-browser tooltip ("在系统浏览器中打开").
- `browser.expandToPage` — float→page tooltip ("展开为页面").
- `browser.collapseToFloat` — page→float tooltip ("收起为浮窗").
- `browser.localOnly` — toast when a non-loopback URL is entered in the address bar ("仅支持本地页面（localhost）").

## Files to Modify

| File | Change |
|---|---|
| `packages/app/src/router.tsx` | Add `project/:projectId/browser` child route → `BrowserPage` |
| `packages/app/src/features/chat/MessageItem.tsx` | Use `useOpenExternalLink()` for external links |
| `packages/app/src/features/content-browser/ContentView.tsx` | Use `useOpenExternalLink()` for external links |
| `packages/app/src/ui-sdk/handlers/open-external-link.ts` | Route loopback URLs via `openExternalUrl` |
| `packages/app/src/lib/feature-registry.ts` | Add `"browser": ELECTRON_ONLY` |
| `packages/app/src/layouts/ProjectScope.tsx` | Mount `BrowserManager` under `FeatureGate` |
| `packages/app/src/features/activity-bar/use-project-actions.ts` | Call `clearBrowser` on project close |
| `packages/app/src/ui-sdk/index.ts` | (No new handler files unless ui-sdk `openBrowser` action added; v1 skips it) |
| `packages/i18n/src/locales/{zh-CN,zh-TW,en}.ts` | Add `browser.*` keys |
| `packages/presets/skills/create-ui-theme/` | Document `data-browser-float-*` selectors |

## New Files

| File | Purpose |
|---|---|
| `packages/app/src/features/browser/store.ts` | Multi-window per-URL Zustand store |
| `packages/app/src/features/browser/defaults.ts` | Default size + cascade constants |
| `packages/app/src/features/browser/BrowserManager.tsx` | Renders containers per open window |
| `packages/app/src/features/browser/FloatingBrowserContainer.tsx` | Portal + FloatingFrame + toolbar + view |
| `packages/app/src/features/browser/BrowserToolbar.tsx` | Address bar + refresh + open-in-system |
| `packages/app/src/features/browser/BrowserView.tsx` | iframe renderer |
| `packages/app/src/features/browser/BrowserPageView.tsx` | Full-page toolbar + view + collapse button |
| `packages/app/src/features/browser/open-external-url.ts` | `isLoopbackUrl` + `openExternalUrl` + `useOpenExternalLink` |
| `packages/app/src/features/browser/use-browsed-urls.ts` | Read-only selector hook |
| `packages/app/src/features/browser/index.ts` | Barrel exports |
| `packages/app/src/pages/BrowserPage.tsx` | Route adapter (`?url=`) |
| `packages/app/src/features/browser/store.test.ts` | Store unit tests |
| `packages/app/src/features/browser/open-external-url.test.ts` | `isLoopbackUrl` + routing unit tests |
| `packages/app/src/ui-sdk/handlers/open-external-link.test.ts` | Update for loopback branch |

## Testing

- `open-external-url.test.ts` — `isLoopbackUrl`: true for `localhost`/`127.0.0.1`/`::1` (with/without ports, with paths), false for private-LAN/public/invalid URLs. `openExternalUrl`: loopback + feature-on → `openFloat` called; loopback + feature-off → `openExternal`; non-loopback → `openExternal`.
- `store.test.ts` — open/close/setPosition/setSize/clearProject, cascade offset math, persistence hydrate round-trip, one-window-per-URL enforcement.
- Update `open-external-link.test.ts` — loopback input dispatches to browser store; non-loopback calls `ctx.openExternal`.
- E2E (desktop, per AGENTS.md impact-based selection): touches routing/store/floating window/interception — add one spec "click localhost link → float opens → expand to page-level → collapse back". Run `npm run verify:e2e` before merge.

## Future: Remote (Tunnel) Support via Server Reverse Proxy

Out of scope for v1, but the design anticipates it. To make the in-app browser work over the mobile-access tunnel:

- **Problem**: remotely, an `<iframe src="http://localhost:3000">` resolves `localhost` against the *remote client* (the phone), which cannot reach the host's dev server.
- **Solution**: add a transparent reverse proxy in the Fastify server. The iframe `src` becomes `getProxyUrl(targetUrl)` → `${baseUrl}/api/projects/:id/proxy/__auth/<token>/<target-url>`. The server (reachable via tunnel) proxies to the loopback target. Works uniformly local + remote.
- **Implementation notes** (for the follow-up):
  - New route `packages/server/src/routes/proxy.ts`, wildcard handler using `undici` (dynamic target per request; `@fastify/http-proxy` assumes a fixed upstream).
  - SSRF guard: target host must be loopback (same rule as `isLoopbackUrl`).
  - Generalize `extractPreviewPathToken` (`packages/server/src/auth.ts:24`, currently hardcoded to `/preview/__auth/`) to recognize `/proxy/__auth/`, or use `?token=` query.
  - Strip upstream `X-Frame-Options`/CSP `frame-ancestors` so the iframe embeds.
  - **Asset/base rewriting**: inject `<base href>` into `text/html` responses so root-relative assets route through the proxy (precedent: `features/chat/html-card-src.ts`).
  - **HMR/WebSocket**: Vite/Next HMR uses WS; a plain HTTP proxy won't forward it → HMR breaks over the proxy. Full WS bridge is a further sub-task.
  - Client: add `getProxyUrl(targetUrl)` next to `getPreviewUrl` (`packages/app/src/lib/api.ts:292`).

## Out of Scope

- Server-side reverse proxy / remote (tunnel) browsing (see Future above).
- Back/forward navigation, copy-URL, bookmarks, history.
- Tracking intra-page navigation in the address bar (cross-origin limitation).
- Private-LAN ranges (10.x / 192.168.x / 172.16-31.x) — only loopback in v1.
- Web (non-Electron) host support.
- Z-order/focus management between multiple browser floats.
