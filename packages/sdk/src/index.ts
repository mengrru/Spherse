/**
 * Node-facing entry for `@spherse/sdk`.
 *
 * Re-exports the small, pure set of symbols the renderer (app) and server consume at
 * build/runtime: the SDK constants and the HTML-injection helper. These are string-only
 * utilities with zero transitive dependencies, so importing this entry from a browser
 * bundler (electron-vite) pulls in nothing node-only.
 *
 * The browser *runtime* itself lives under `src/runtime/` and is bundled separately by
 * esbuild into `dist/browser.js`. Its text is exposed as `SDK_SOURCE` via the
 * `@spherse/sdk/source` subpath.
 */
export { SDK_FILENAME, SDK_MARK, SDK_VERSION } from "./meta.js";
export { injectHeadScript } from "./inject-head-script.js";
