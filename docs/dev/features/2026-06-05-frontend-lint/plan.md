# Frontend Lint Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repo-wide ESLint lint setup with React-specific app rules and a non-mutating pre-commit lint gate.

**Architecture:** Install ESLint tooling at the root and keep one root `eslint.config.js` as the only lint configuration boundary. Root scripts provide the canonical full-repo lint entrypoint, workspace scripts provide local package entrypoints, and Husky runs the root lint command before commits without modifying or staging files.

**Tech Stack:** ESLint 9 flat config, `@typescript-eslint` parser/plugin, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals`, Husky 9, npm workspaces, TypeScript, React 19.

---

## Source Documents

- Design: `docs/dev/features/2026-06-05-frontend-lint/design.md`
- Backlog: `docs/dev/backlog.md`
- Project instructions: `AGENTS.md`

## File Structure

- Create: `eslint.config.js`
  - Owns all lint ignores, TypeScript rules, React app override, Node/Electron override, and test-file override.
- Create: `.husky/pre-commit`
  - Runs `npm run lint` only. It must not run `lint:fix`, `git add`, or any command that mutates files.
- Modify: `package.json`
  - Add root `lint`, `lint:fix`, and `prepare` scripts.
  - Add root lint-related dev dependencies.
- Modify: `package-lock.json`
  - Lock lint-related dependency versions from `npm install`.
- Modify: `packages/app/package.json`
  - Add `lint` and `lint:fix` scripts for app workspace execution.
- Modify: `packages/core/package.json`
  - Add `lint` and `lint:fix` scripts for core workspace execution.
- Modify: `packages/server/package.json`
  - Add `lint` and `lint:fix` scripts for server workspace execution.
- Modify: `packages/presets/package.json`
  - Add `lint` and `lint:fix` scripts for presets workspace execution.

Do not commit during implementation unless the user explicitly asks. The repository instruction says code completion should wait for a manual commit request.

---

### Task 1: Install Lint Tooling and Add Scripts

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `packages/app/package.json`
- Modify: `packages/core/package.json`
- Modify: `packages/server/package.json`
- Modify: `packages/presets/package.json`

- [ ] **Step 1: Install root dev dependencies**

Run from repo root:

```bash
npm install -D eslint @eslint/js @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-plugin-react-hooks eslint-plugin-react-refresh globals husky
```

Expected: `package.json` gains root `devDependencies`, and `package-lock.json` is updated. Exact dependency versions should be whatever npm resolves for the current lockfile.

- [ ] **Step 2: Add root lint scripts**

Run from repo root:

```bash
npm pkg set "scripts.lint=eslint ." "scripts.lint:fix=eslint . --fix" "scripts.prepare=husky"
```

Expected root `package.json` scripts include:

```json
{
  "scripts": {
    "predev": "node scripts/rebuild-native.mjs",
    "build": "npm run build -w @spherse/core && npm run build -w @spherse/presets && npm run build -w @spherse/server && npm run build -w @spherse/app",
    "dev": "npm run dev --workspace=packages/app",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "prepare": "husky"
  }
}
```

- [ ] **Step 3: Add workspace lint scripts**

Run from repo root:

```bash
npm pkg set --workspace=@spherse/app "scripts.lint=eslint ." "scripts.lint:fix=eslint . --fix"
npm pkg set --workspace=@spherse/core "scripts.lint=eslint ." "scripts.lint:fix=eslint . --fix"
npm pkg set --workspace=@spherse/server "scripts.lint=eslint ." "scripts.lint:fix=eslint . --fix"
npm pkg set --workspace=@spherse/presets "scripts.lint=eslint ." "scripts.lint:fix=eslint . --fix"
```

Expected each workspace `package.json` has:

```json
{
  "scripts": {
    "lint": "eslint .",
    "lint:fix": "eslint . --fix"
  }
}
```

Keep existing scripts such as `build`, `dev`, `test`, and `test:e2e` unchanged.

- [ ] **Step 4: Verify scripts exist before config is added**

Run from repo root:

```bash
npm run lint
```

Expected: FAIL because `eslint.config.js` does not exist yet, or because ESLint cannot find a config. This confirms the root script is wired before adding the config.

---

### Task 2: Add Root ESLint Flat Config

**Files:**
- Create: `eslint.config.js`

- [ ] **Step 1: Create `eslint.config.js`**

Create `eslint.config.js` with this content:

```js
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

const tsFiles = [
  "packages/*/src/**/*.{ts,tsx}",
  "packages/app/electron/**/*.ts",
  "packages/app/*.{ts,tsx}",
  "packages/*/scripts/**/*.mjs",
  "scripts/**/*.mjs",
  "*.config.{js,mjs,ts}",
];

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "docs/**",
      ".superpowers/**",
      "packages/presets/templates/**",
      "packages/*/dist/**",
    ],
  },
  js.configs.recommended,
  {
    files: tsFiles,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["packages/app/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: [
      "packages/core/src/**/*.ts",
      "packages/server/src/**/*.ts",
      "packages/presets/src/**/*.ts",
      "packages/app/electron/**/*.ts",
      "packages/app/*.{ts,tsx}",
      "packages/*/scripts/**/*.mjs",
      "scripts/**/*.mjs",
      "*.config.{js,mjs,ts}",
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
```

- [ ] **Step 2: Run root lint to expose first real lint issues**

Run from repo root:

```bash
npm run lint
```

Expected: one of these outcomes:

- PASS, if current code already satisfies the selected rules.
- FAIL with concrete ESLint diagnostics. Diagnostics should be limited to high-signal issues such as unused variables/imports, React Hooks rule violations, or flat-config mistakes.

- [ ] **Step 3: Fix only high-signal first-run issues**

If `npm run lint` fails, apply this bounded policy:

- Remove unused imports or unused variables reported by `@typescript-eslint/no-unused-vars`.
- If a variable is intentionally unused and is part of an existing API or tuple pattern, rename it with a leading underscore, for example `event` to `_event`.
- Fix React Hooks dependency diagnostics by adding the missing dependency or by moving the value inside the effect only when that preserves behavior.
- If `react-refresh/only-export-components` reports warnings only, keep them as warnings unless `npm run lint` exits non-zero because of them.
- Do not enable `no-explicit-any`.
- Do not enable `no-console`.
- Do not introduce Prettier or formatting-only changes.

After each small fix, rerun:

```bash
npm run lint
```

Expected: repeat until `npm run lint` exits 0.

---

### Task 3: Add Non-Mutating Husky Pre-Commit Hook

**Files:**
- Create: `.husky/pre-commit`
- Modify: `package.json` if `prepare` was not added in Task 1

- [ ] **Step 1: Initialize Husky directory**

Run from repo root:

```bash
npm run prepare
```

Expected: `.husky/` exists. If Husky prints setup output, keep it. Do not create lint-staged config.

- [ ] **Step 2: Create pre-commit hook**

Create `.husky/pre-commit` with this exact content:

```sh
npm run lint
```

Then run:

```bash
chmod +x .husky/pre-commit
```

Expected: the hook contains only `npm run lint`; it does not contain `npm run lint:fix`, `git add`, or any file-writing command.

- [ ] **Step 3: Verify hook passes on clean lint state**

Run from repo root:

```bash
.husky/pre-commit
```

Expected: PASS and same output behavior as `npm run lint`.

- [ ] **Step 4: Verify hook blocks without mutating files**

Create a temporary lint-smoke file `packages/app/src/__lint-hook-smoke__.ts` with this content:

```ts
const unusedLintHookSmoke = 1;
```

Run from repo root:

```bash
.husky/pre-commit
```

Expected: FAIL with an unused variable diagnostic for `unusedLintHookSmoke`.

Run:

```bash
git diff -- packages/app/src/__lint-hook-smoke__.ts
```

Expected: the file content is still exactly:

```ts
const unusedLintHookSmoke = 1;
```

Delete `packages/app/src/__lint-hook-smoke__.ts`.

Run:

```bash
npm run lint
```

Expected: PASS after deleting the smoke file.

---

### Task 4: Verify Workspace Entrypoints

**Files:**
- Modify: `eslint.config.js` only if workspace invocation reveals a path/config issue
- Modify: workspace `package.json` scripts only if `eslint .` cannot work consistently under npm workspace execution

- [ ] **Step 1: Run app workspace lint**

Run from repo root:

```bash
npm run lint --workspace=packages/app
```

Expected: PASS. This validates React app files, Electron files, and app root config files can be linted from the app workspace.

- [ ] **Step 2: Run core workspace lint**

Run from repo root:

```bash
npm run lint --workspace=packages/core
```

Expected: PASS.

- [ ] **Step 3: Run server workspace lint**

Run from repo root:

```bash
npm run lint --workspace=packages/server
```

Expected: PASS.

- [ ] **Step 4: Run presets workspace lint**

Run from repo root:

```bash
npm run lint --workspace=packages/presets
```

Expected: PASS, and `packages/presets/templates/**` remains ignored.

- [ ] **Step 5: Adjust scripts only if workspace execution is inconsistent**

If any workspace command fails because `eslint .` resolves paths incorrectly under npm workspace execution, change all workspace lint scripts to repo-relative paths from the workspace directory:

```json
{
  "scripts": {
    "lint": "eslint ../../packages/app",
    "lint:fix": "eslint ../../packages/app --fix"
  }
}
```

Use the matching path for each workspace:

- `../../packages/app`
- `../../packages/core`
- `../../packages/server`
- `../../packages/presets`

After changing scripts, rerun all four workspace lint commands from Steps 1-4. Expected: PASS for all four.

---

### Task 5: Final Verification

**Files:**
- No planned edits unless verification exposes a regression

- [ ] **Step 1: Run root lint**

Run from repo root:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 2: Run all workspace lint entrypoints**

Run from repo root:

```bash
npm run lint --workspace=packages/app
npm run lint --workspace=packages/core
npm run lint --workspace=packages/server
npm run lint --workspace=packages/presets
```

Expected: all four commands PASS.

- [ ] **Step 3: Run build**

Run from repo root:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Run core tests**

Run from repo root:

```bash
npm test --workspace=packages/core
```

Expected: PASS.

- [ ] **Step 5: Run app tests**

Run from repo root:

```bash
npm test --workspace=packages/app
```

Expected: PASS.

- [ ] **Step 6: Inspect final diff**

Run from repo root:

```bash
git diff --stat
git diff -- eslint.config.js .husky/pre-commit package.json package-lock.json packages/app/package.json packages/core/package.json packages/server/package.json packages/presets/package.json
```

Expected: diff only includes lint config, hook, dependency/script updates, and any minimal high-signal lint fixes required by Task 2. It must not include Prettier-style full-file formatting or unrelated business logic changes.

---

## Self-Review Checklist

- Spec coverage: Tasks 1-2 implement repo-wide ESLint and app React rules; Task 3 implements non-mutating commit hook; Task 4 verifies all package lint entrypoints; Task 5 covers final verification.
- Scope control: The plan does not introduce Prettier, Biome, lint-staged, online CI, PR workflow changes, `no-explicit-any`, or `no-console`.
- Backlog alignment: Follow-up work for banning `any`, tightening console lint, and adding local verification pipelines remains in `docs/dev/backlog.md` and is not implemented here.
- Type/rule consistency: The ESLint config keeps `any` and `console` allowed, ignores `docs/**`, keeps `React.` namespace style allowed, and gives browser globals only to app renderer files while Node globals apply to Electron, Node packages, scripts, and app root config files.
- No commit: The plan intentionally omits commit steps because `AGENTS.md` says to wait for explicit user request before committing.
