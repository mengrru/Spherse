# Text Selection Session Bugfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `text-selection-session` button placement/style, make the start-session popover fixed width, preserve visible selection context while the popover is open, and add minimal Playwright Electron E2E coverage.

**Architecture:** Keep the fix inside `packages/app/src/features/text-selection-session/` except for E2E test infrastructure. Extend selection state with viewport rects, render a passive overlay while the popover is open, and use viewport-aware fixed positioning for the button and popover. Add a minimal Electron E2E helper and one regression spec that opens a temporary project, navigates to a Markdown file, selects text, and asserts the UI behavior.

**Tech Stack:** TypeScript, React 19, Electron, electron-vite, Tailwind CSS v4, shadcn/Base UI components, Vitest, Playwright Electron.

---

## Design Reference

- Design doc: `docs/dev/bugfix/2026-06-02-text-selection-session/design.md`
- Existing feature doc: `docs/dev/features/2026-05-26-text-selection-session/design.md`
- Relevant app docs: `docs/official/architecture.md`, `docs/official/project-structure.md`

## File Structure

### Modify

- `packages/app/src/features/text-selection-session/hooks/useTextSelection.ts`
  - Owns selection detection, text capture, viewport rect capture, and scroll/resize cleanup.
- `packages/app/src/features/text-selection-session/StartSessionButton.tsx`
  - Owns the floating action button rendering, stable test id, style, and center-anchor positioning.
- `packages/app/src/features/text-selection-session/StartSessionPopover.tsx`
  - Owns the fixed-width start-session popover, stable test id, and viewport clamping.
- `packages/app/src/features/text-selection-session/index.tsx`
  - Wires selection state, button, popover, and overlay together.
- `packages/app/package.json`
  - Adds `test:e2e` script and `@playwright/test` dev dependency.
- `package-lock.json`
  - Updated by `npm install` after adding Playwright.

### Create

- `packages/app/src/features/text-selection-session/SelectionHighlightOverlay.tsx`
  - Renders passive fixed-position highlight rectangles while the start-session popover is open.
- `packages/app/playwright.config.ts`
  - Configures Playwright for Electron E2E tests.
- `packages/app/e2e/helpers/electron.ts`
  - Creates temporary Spherse projects and launches Electron with isolated app data.
- `packages/app/e2e/text-selection-session.spec.ts`
  - Covers selecting text, button placement, fixed popover width, and overlay presence.

## Task 1: Add Minimal E2E Infrastructure

**Files:**
- Modify: `packages/app/package.json`
- Modify: `package-lock.json`
- Create: `packages/app/playwright.config.ts`
- Create: `packages/app/e2e/helpers/electron.ts`

- [ ] **Step 1: Install Playwright dependency**

Run:

```bash
npm install -D @playwright/test --workspace=packages/app
```

Expected: `packages/app/package.json` contains `@playwright/test` under `devDependencies`, and `package-lock.json` contains Playwright package entries.

- [ ] **Step 2: Add E2E script**

Edit `packages/app/package.json` so the `scripts` object is:

```json
{
  "build": "electron-vite build",
  "dev": "electron-vite dev",
  "preview": "electron-vite preview",
  "test": "vitest run",
  "test:e2e": "playwright test -c playwright.config.ts"
}
```

- [ ] **Step 3: Create Playwright config**

Create `packages/app/playwright.config.ts`:

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
});
```

- [ ] **Step 4: Create Electron E2E helper**

Create `packages/app/e2e/helpers/electron.ts`:

```typescript
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "../..");
const mainEntry = path.join(appRoot, "dist", "main", "index.js");
const rendererEntry = path.join(appRoot, "dist", "renderer", "index.html");

export interface TestProject {
  root: string;
  contentPath: string;
}

export async function createTextSelectionProject(): Promise<TestProject> {
  const root = await mkdtemp(path.join(tmpdir(), "spherse-e2e-"));
  await mkdir(path.join(root, ".spherse", "agents"), { recursive: true });
  await mkdir(path.join(root, "world"), { recursive: true });
  await writeFile(
    path.join(root, ".spherse", "agents", "writer.md"),
    [
      "---",
      "id: writer",
      "name: Writer",
      "model: openai/gpt-4o-mini",
      "tools: []",
      "---",
      "You help with writing.",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "world", "lore.md"),
    [
      "# Lore",
      "",
      "The obsidian tower stands beside the northern sea.",
      "Its beacon wakes when the moon turns red.",
      "",
    ].join("\n"),
  );
  return { root, contentPath: "world/lore.md" };
}

export async function launchAppWithProject(project: TestProject): Promise<{ app: ElectronApplication; page: Page }> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-user-data-"));
  const app = await electron.launch({
    args: [mainEntry],
    cwd: appRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      ELECTRON_ENABLE_LOGGING: "1",
      XDG_CONFIG_HOME: userDataDir,
    },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(async (projectRoot) => {
    await window.electronAPI.addOpenProject(projectRoot);
    await window.electronAPI.setLastActiveProject(projectRoot);
    window.location.reload();
  }, project.root);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForURL(/#\/project\//);
  const hash = await page.evaluate(() => window.location.hash.replace(/^#/, ""));
  const projectUrl = hash.replace(/\/chat\/.*$/, "").replace(/\/content.*$/, "");
  await page.goto(`file://${rendererEntry}#${projectUrl}/content?path=${encodeURIComponent(project.contentPath)}`);
  await page.waitForSelector("text=The obsidian tower stands beside the northern sea.");
  return { app, page };
}
```

- [ ] **Step 5: Run app tests after Tasks 2-4**

Run after Tasks 2-4 are complete:

```bash
npm test --workspace=packages/app
```

Expected: Vitest exits with code 0.

## Task 2: Add Selection Rect Capture and Cleanup

**Files:**
- Modify: `packages/app/src/features/text-selection-session/hooks/useTextSelection.ts`

- [ ] **Step 1: Replace selection state type and helper functions**

Replace the contents of `packages/app/src/features/text-selection-session/hooks/useTextSelection.ts` with:

```typescript
import { useEffect, useRef, useState } from "react";

interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SelectionState {
  text: string;
  position: { x: number; y: number };
  highlightRects: HighlightRect[];
}

const VIEWPORT_PADDING = 8;
const BUTTON_ESTIMATED_WIDTH = 112;
const BUTTON_ESTIMATED_HEIGHT = 32;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function toHighlightRect(rect: DOMRect): HighlightRect | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function getHighlightRects(range: Range): HighlightRect[] {
  const rects = Array.from(range.getClientRects())
    .map(toHighlightRect)
    .filter((rect): rect is HighlightRect => Boolean(rect));
  if (rects.length > 0) return rects;
  const fallback = toHighlightRect(range.getBoundingClientRect());
  return fallback ? [fallback] : [];
}

function getBoundingRect(rects: HighlightRect[]) {
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.left + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.top + rect.height));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function getButtonPosition(rects: HighlightRect[]) {
  const bounds = getBoundingRect(rects);
  const centerX = bounds.left + bounds.width / 2;
  const minX = VIEWPORT_PADDING + BUTTON_ESTIMATED_WIDTH / 2;
  const maxX = window.innerWidth - VIEWPORT_PADDING - BUTTON_ESTIMATED_WIDTH / 2;
  const x = clamp(centerX, minX, Math.max(minX, maxX));
  const yAbove = bounds.top - BUTTON_ESTIMATED_HEIGHT - VIEWPORT_PADDING;
  const yBelow = bounds.bottom + VIEWPORT_PADDING;
  const y = yAbove >= VIEWPORT_PADDING
    ? yAbove
    : clamp(yBelow, VIEWPORT_PADDING, window.innerHeight - BUTTON_ESTIMATED_HEIGHT - VIEWPORT_PADDING);
  return { x, y };
}

export function useTextSelection({
  disabled,
}: {
  disabled: boolean;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [selectionState, setSelectionState] = useState<SelectionState | null>(null);

  useEffect(() => {
    if (disabled) return;

    const handleMouseUp = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        setSelectionState(null);
        return;
      }

      const contentEl = contentRef.current;
      if (!contentEl || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      if (!contentEl.contains(range.commonAncestorContainer)) return;

      const text = selection.toString().trim();
      const highlightRects = getHighlightRects(range);
      if (highlightRects.length === 0) {
        setSelectionState(null);
        return;
      }

      setSelectionState({
        text,
        position: getButtonPosition(highlightRects),
        highlightRects,
      });
    };

    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [disabled]);

  useEffect(() => {
    if (!selectionState) return;

    const clear = () => setSelectionState(null);
    window.addEventListener("resize", clear);
    window.addEventListener("scroll", clear, true);
    return () => {
      window.removeEventListener("resize", clear);
      window.removeEventListener("scroll", clear, true);
    };
  }, [selectionState]);

  return {
    contentRef,
    selectionState,
    setSelectionState,
  };
}
```

- [ ] **Step 2: Run TypeScript build to catch type errors**

Run:

```bash
npm run build --workspace=packages/app
```

Expected: build exits with code 0.

## Task 3: Add Selection Highlight Overlay

**Files:**
- Create: `packages/app/src/features/text-selection-session/SelectionHighlightOverlay.tsx`
- Modify: `packages/app/src/features/text-selection-session/index.tsx`

- [ ] **Step 1: Create overlay component**

Create `packages/app/src/features/text-selection-session/SelectionHighlightOverlay.tsx`:

```typescript
interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SelectionHighlightOverlayProps {
  rects: HighlightRect[];
}

export function SelectionHighlightOverlay({ rects }: SelectionHighlightOverlayProps) {
  return (
    <div className="pointer-events-none fixed inset-0 z-40" data-testid="text-selection-highlight">
      {rects.map((rect, index) => (
        <div
          key={`${rect.left}-${rect.top}-${rect.width}-${rect.height}-${index}`}
          className="absolute rounded-[1px] bg-primary/20"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Wire overlay into TextSelectionSession**

Modify `packages/app/src/features/text-selection-session/index.tsx` to add the import:

```typescript
import { SelectionHighlightOverlay } from "./SelectionHighlightOverlay";
```

Then render the overlay before the popover:

```tsx
{selectionState && showStartPopover && (
  <SelectionHighlightOverlay rects={selectionState.highlightRects} />
)}
{selectionState && showStartPopover && (
  <StartSessionPopover
    selectedText={selectionState.text}
    sourcePath={sourcePath}
    agents={agents}
    position={selectionState.position}
    onSubmit={(agentId, comment) => {
      onStartSession?.(agentId, selectionState.text, sourcePath, comment);
      setShowStartPopover(false);
      clearSelection();
    }}
    onClose={() => {
      setShowStartPopover(false);
      clearSelection();
    }}
  />
)}
```

- [ ] **Step 3: Run app build**

Run:

```bash
npm run build --workspace=packages/app
```

Expected: build exits with code 0.

## Task 4: Fix Button Positioning, Style, and Test ID

**Files:**
- Modify: `packages/app/src/features/text-selection-session/StartSessionButton.tsx`

- [ ] **Step 1: Update StartSessionButton rendering**

Replace the returned `<Button>` in `packages/app/src/features/text-selection-session/StartSessionButton.tsx` with:

```tsx
<Button
  ref={ref}
  variant="secondary"
  size="sm"
  className="fixed z-50 -translate-x-1/2 shadow-lg ring-1 ring-border/60"
  style={{
    left: position.x,
    top: position.y,
  }}
  data-testid="text-selection-start-button"
  onMouseDown={(event) => {
    event.stopPropagation();
    event.preventDefault();
    onStart();
  }}
>
  <MessageCircleIcon className="size-3.5" />
  发起会话
</Button>
```

- [ ] **Step 2: Run app build**

Run:

```bash
npm run build --workspace=packages/app
```

Expected: build exits with code 0.

## Task 5: Fix Popover Width and Viewport Clamping

**Files:**
- Modify: `packages/app/src/features/text-selection-session/StartSessionPopover.tsx`

- [ ] **Step 1: Replace popover position helper**

In `packages/app/src/features/text-selection-session/StartSessionPopover.tsx`, replace `getPopoverPosition` with:

```typescript
const POPOVER_WIDTH = 360;
const VIEWPORT_PADDING = 8;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function getPopoverPosition(position: { x: number; y: number }) {
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_PADDING * 2);
  const left = clamp(
    position.x - width / 2,
    VIEWPORT_PADDING,
    window.innerWidth - width - VIEWPORT_PADDING,
  );
  const top = clamp(
    position.y + 40,
    VIEWPORT_PADDING,
    window.innerHeight - 296,
  );
  return {
    left,
    top,
    width,
    maxHeight: window.innerHeight - VIEWPORT_PADDING * 2,
  };
}
```

- [ ] **Step 2: Add popover test id and stable overflow class**

Update the root popover `<div>` to include `data-testid`:

```tsx
<div
  ref={ref}
  className="fixed z-50 rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
  style={getPopoverPosition(position)}
  data-testid="text-selection-popover"
  onMouseDown={(event) => event.stopPropagation()}
>
```

Keep the existing inner `p-3 overflow-y-auto` container.

- [ ] **Step 3: Run app build**

Run:

```bash
npm run build --workspace=packages/app
```

Expected: build exits with code 0.

## Task 6: Add Text Selection Session E2E Regression Spec

**Files:**
- Create: `packages/app/e2e/text-selection-session.spec.ts`

- [ ] **Step 1: Create E2E spec**

Create `packages/app/e2e/text-selection-session.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";
import { createTextSelectionProject, launchAppWithProject } from "./helpers/electron";

test("text selection session shows stable button, fixed popover, and highlight overlay", async () => {
  const project = await createTextSelectionProject();
  const { app, page } = await launchAppWithProject(project);

  try {
    await page.waitForSelector("text=The obsidian tower stands beside the northern sea.");
    await page.evaluate(() => {
      const textNode = [...document.querySelectorAll("p")]
        .flatMap((node) => [...node.childNodes])
        .find((node) => node.textContent?.includes("obsidian tower"));
      if (!textNode) throw new Error("target text node not found");
      const start = textNode.textContent!.indexOf("obsidian tower");
      const end = start + "obsidian tower stands beside".length;
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    const button = page.getByTestId("text-selection-start-button");
    await expect(button).toBeVisible();
    const buttonBox = await button.boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.x).toBeGreaterThanOrEqual(0);
    expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(1200);

    await button.click();
    const popover = page.getByTestId("text-selection-popover");
    await expect(popover).toBeVisible();
    const popoverBox = await popover.boundingBox();
    expect(popoverBox).not.toBeNull();
    expect(Math.round(popoverBox!.width)).toBe(360);

    const highlight = page.getByTestId("text-selection-highlight");
    await expect(highlight).toBeVisible();
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run E2E spec and capture failures**

Run:

```bash
npm run build --workspace=packages/app
npm run test:e2e --workspace=packages/app -- text-selection-session.spec.ts
```

Expected after implementation: build exits with code 0 and Playwright reports `1 passed`.

## Task 7: Final Verification

**Files:**
- Verify all files changed by Tasks 1-6.

- [ ] **Step 1: Run Vitest**

Run:

```bash
npm test --workspace=packages/app
```

Expected: command exits with code 0.

- [ ] **Step 2: Run app build**

Run:

```bash
npm run build --workspace=packages/app
```

Expected: command exits with code 0.

- [ ] **Step 3: Run E2E regression**

Run:

```bash
npm run test:e2e --workspace=packages/app
```

Expected: Playwright reports the text-selection-session spec passed.

- [ ] **Step 4: Inspect git diff**

Run:

```bash
git diff -- packages/app/package.json package-lock.json packages/app/playwright.config.ts packages/app/e2e packages/app/src/features/text-selection-session
```

Expected: diff only includes the planned text-selection-session fixes, E2E infra, package script/dependency updates, and no unrelated edits.

## Notes for Implementers

- Do not change `ProjectLayout.handleStartSession` message construction or navigation behavior.
- Do not add support for HTML iframe preview selection.
- Do not replace the current button/popover with a full Base UI Popover migration in this bugfix.
- Do not commit automatically; this repository waits for an explicit user request before commits.
