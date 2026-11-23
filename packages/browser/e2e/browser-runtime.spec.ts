import { expect, test } from "@playwright/test";
import { rpcCall, setupMiniRpc } from "./helpers/mini-rpc";

test.describe("browser runtime e2e", () => {
  test("boots the shell, creates a project and renders the project view", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("text=打开或创建项目", { timeout: 20000 });
    await page.click("text=打开或创建项目");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("项目名称").fill(`e2e-${Date.now()}`);
    await dialog.getByRole("button", { name: "创建", exact: true }).click();
    await page.waitForURL(/#\/project\/.+/, { timeout: 30000 });
    await expect(page.locator("body")).toContainText("对话", { timeout: 20000 });
  });
});

test.describe("resource plane via SW", () => {
  test("serves preview assets with injection, ranges and policy parity", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);
    await setupMiniRpc(page);
    const rpc = (method: string, params: Record<string, unknown>) => rpcCall(page, method, params);
    const { projectId } = await rpc("browser.createProject", { name: `res-${Date.now()}` });
    await rpc("content.save", {
      projectId,
      path: "cards/demo.html",
      content:
        '<!doctype html><html><head></head><body><h1>Card OK</h1><img src="assets/ok.svg"></body></html>',
    });
    await rpc("content.save", {
      projectId,
      path: "cards/assets/ok.svg",
      content: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>',
    });
    await rpc("content.save", {
      projectId,
      path: "cards/denied.exe",
      content: "binary-ish",
    });
    await rpc("content.save", {
      projectId,
      path: ".spherse/theme.css",
      content: ":root { --accent: rgb(11, 22, 33); }",
    });

    const results = await page.evaluate(async (projectId) => {
      const base = `/api/projects/${projectId}/preview`;
      const out: Record<string, unknown> = {};
      const html = await fetch(`${base}/cards/demo.html`);
      out.htmlStatus = html.status;
      out.htmlType = html.headers.get("content-type");
      out.htmlInjected = (await html.text()).includes("__spherse-sdk.js");
      const sdk = await fetch(`${base}/cards/__spherse-sdk.js`);
      out.sdkStatus = sdk.status;
      out.sdkType = sdk.headers.get("content-type");
      out.sdkBody = (await sdk.text()).length > 1000;
      const svg = await fetch(`${base}/cards/assets/ok.svg`);
      out.svgStatus = svg.status;
      out.svgType = svg.headers.get("content-type");
      const range = await fetch(`${base}/cards/assets/ok.svg`, { headers: { Range: "bytes=0-9" } });
      out.rangeStatus = range.status;
      out.rangeLen = (await range.arrayBuffer()).byteLength;
      out.rangeHeader = range.headers.get("content-range");
      const missing = await fetch(`${base}/cards/missing.html`);
      out.missingStatus = missing.status;
      const denied = await fetch(`${base}/cards/denied.exe`);
      out.deniedStatus = denied.status;
      const escaped = await fetch(`${base}/cards/%2e%2e%2f%2e%2e%2foutside.txt`);
      out.escapedStatus = escaped.status;
      const auth = await fetch(`${base}/__auth/whatever/cards/demo.html`);
      out.authStrippedStatus = auth.status;
      const theme = await fetch(`${base}/__auth/whatever/.spherse/theme.css`);
      out.themeStatus = theme.status;
      out.themeType = theme.headers.get("content-type");
      return out;
    }, projectId);

    expect(results.htmlStatus).toBe(200);
    expect(results.htmlType).toContain("text/html");
    expect(results.htmlInjected).toBe(true);
    expect(results.sdkStatus).toBe(200);
    expect(results.sdkType).toContain("javascript");
    expect(results.sdkBody).toBe(true);
    expect(results.svgStatus).toBe(200);
    expect(results.svgType).toContain("svg");
    expect(results.rangeStatus).toBe(206);
    expect(results.rangeLen).toBe(10);
    expect(String(results.rangeHeader)).toMatch(/^bytes 0-9\//);
    expect(results.missingStatus).toBe(404);
    expect(results.deniedStatus).toBe(403);
    expect(results.escapedStatus).toBe(403);
    expect(results.authStrippedStatus).toBe(200);
    expect(results.themeStatus).toBe(200);
    expect(results.themeType).toContain("text/css");

    const iframeRendered = await page.evaluate(async (projectId) => {
      const iframe = document.createElement("iframe");
      iframe.src = `/api/projects/${projectId}/preview/cards/demo.html`;
      document.body.appendChild(iframe);
      const loaded = await new Promise<boolean>((resolve) => {
        iframe.addEventListener("load", () => resolve(true), { once: true });
        setTimeout(() => resolve(false), 8000);
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const doc = iframe.contentDocument;
      const h1 = doc?.querySelector("h1")?.textContent;
      let imgLoaded = false;
      const img = doc?.querySelector("img") as (HTMLImageElement & { complete: boolean; naturalWidth: number }) | null | undefined;
      if (img) {
        for (let i = 0; i < 40 && !(img.complete && img.naturalWidth > 0); i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        imgLoaded = Boolean(img.complete && img.naturalWidth > 0);
      }
      const sdkScript = doc?.querySelector("script[data-spherse-sdk], script[src='__spherse-sdk.js']") !== null;
      iframe.remove();
      return { loaded, h1, imgLoaded, sdkScript };
    }, projectId);
    expect(iframeRendered.loaded).toBe(true);
    expect(iframeRendered.h1).toBe("Card OK");
    expect(iframeRendered.imgLoaded).toBe(true);
    expect(iframeRendered.sdkScript).toBe(true);

  });
});
