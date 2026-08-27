---
name: code-review
description: Use when dispatching a sub agent to review implemented code (dev-flow step 4, after commit), or whenever the user asks for a code review of committed work
---

# Code Review Skill

## Positioning

This skill guarantees the **floor** of a code review — discipline and repo-specific knowledge — and never the ceiling. It exists to make reviews reliable (no unverified claims, no missed repo red lines, consistent output), not to make them mechanical.

The perspectives and red lines below are **minimum coverage, not a boundary**. Findings outside them must be reported regardless of dimension. Never conclude "checklist complete ⇒ approved".

## Dispatch template

The main agent loads this skill, then dispatches a review sub agent (research-only task) with:

1. **Scope**: commit range or file list to review
2. **Context**: design doc path if one exists (dev-flow step 2 output); otherwise the requirement summary
3. **Discipline + perspectives + red lines + output contract**: inline the sections below into the dispatch prompt
4. **Report language**: Chinese

## Discipline rules

- **Review-only**: the sub agent researches and reports; it never modifies files
- **Verify before claiming**: every finding cites `file:line` evidence from actual code. Check the surrounding reality, not just the diff — most hard errors live outside the changed lines
- **Hunches are allowed, labeled**: suspicions without evidence go to a separate "未验证疑点" section, explicitly marked as unverified
- **No rubber-stamping**: absence of findings must be stated as "抽查未发现", never as a guarantee

## Perspectives (lenses, not steps)

- **Design fidelity**: implementation vs design doc — missing pieces, silent deviations, undocumented decisions
- **Correctness**: logic, edge cases, error paths, backward compatibility (esp. persisted-data migrations)
- **Boundaries & security**: access policy, path safety, contract usage, concurrency (see red lines)
- **Test adequacy**: contract tests for cross-layer seams (PM facade / `SessionPort` methods — consumer packages each need at least one that doesn't mock the tested method); affected-surface coverage for the change
- **Doc-sync triggers**: surfaces whose docs need updating (report only — doc updates are handled by the **doc-sync** skill afterwards, not by the reviewer)

## Repo red lines (check at minimum)

- Path safety: `resolveProjectPath` / `assertInsideProject` / `isPathInside`; `startsWith` prefix checks are path traversal bugs
- Contracts: HTTP/WS boundary schemas live in `@spherse/server/contracts` and reuse the shared parsers; no new raw `JSON.parse` at boundaries
- Concurrency: never construct a new `FileWriteMutex` — the assembly point owns the single instance, injected everywhere
- Export surface: package `index.ts` exports only consumed symbols; `export type` for type-only
- No comments unless explicitly requested
- Capability changes: **git diff acceptance** — touching existing files in tools/session/access means a kernel contribution point is missing; fix the interface, don't open holes in consumers
- Session persistence: append-only via `SessionEventLog.append/appendBatch`; no mutation of persisted events
- User-visible strings: must go through `@spherse/i18n` with all three locales updated

Package-specific deep rules: `packages/core/README.md`（增加能力的原则 / 关键约定）, `packages/app/README.md`（renderer 规则与检查清单）, `packages/server/README.md`（routes & contracts 规范）.

## Output contract

- Severity levels: **critical** / **important** / **medium** / **minor**
- Each finding: location (`file:line`), evidence, why it matters, suggested fix
- Optional "未验证疑点" section for labeled hunches
- One-line overall verdict at the end
