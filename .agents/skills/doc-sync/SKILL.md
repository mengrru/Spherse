---
name: doc-sync
description: Use after completing a feature/infra/bugfix change or before committing, to verify docs/official, package READMEs, and backlog are in sync with the change
---

# Documentation Sync Skill

## Purpose

Every code change has a documentation surface. This skill walks the full checklist so nothing is missed: official docs stay current, package READMEs stay accurate, and the backlog reflects completed work. Run it when a feature/infra/bugfix is finished, or whenever the user asks to commit.

## Process

1. **Determine the change surface.**
   - If changes are uncommitted: read `git status` and `git diff` (staged + unstaged).
   - If the work spans commits: read `git log` and per-commit diffs for this branch.
   - List the touched packages, directories, public exports, data formats, and cross-package seams.

2. **Walk the sync checklist below** and check every row that matches the change surface. Do not skip rows silently — each row must end up either "updated" or "no impact, because ...".

3. **Apply updates** following the writing rules.

4. **Report**: list each checklist row with its outcome (updated / no impact). Flag anything you intentionally did not update and why.

## Sync checklist

| Change | Must sync |
|---|---|
| Files/dirs/packages added, moved, or removed | `docs/official/project-structure.md` (tree + surrounding notes). Exception: `.agents/` and `.opencode/` are deliberately NOT recorded there — do not add them back |
| Architecture decisions, package boundaries, capability/assembly changes, API contract approach | the matching domain file under `docs/official/architecture/` (routing table in `docs/official/README.md`; follow its writing rules) |
| An architecture decision made or overturned | append a new ADR under `docs/dev/decisions/` (thin: 10-20 lines; overturned ⇒ only flip status to superseded); link it from the matching official doc claim |
| Data file formats, storage location conventions | `docs/official/data-conventions.md` |
| New domain concept or overloaded term introduced | `docs/official/glossary.md` (one-line definition + authoritative doc link) |
| Package-level coding/review rules | the package's own README (`packages/{pkg}/README.md`) |
| User-visible strings | the **i18n** skill (add keys + translations) |
| Design system, theme mechanism, chat DOM/layout/CSS tokens, themeable selectors | `packages/presets/skills/spherse-create-ui-theme/` and `packages/presets/skills/spherse-create-agent-chat-theme/` |
| Presets templates or skill sources edited under `packages/presets/` | trigger the sync build so generated constants are usable: `npm run build --workspace=packages/presets` (see `packages/presets/README.md`) |
| A backlog item completed | tick it in `docs/dev/backlog.md`; append newly-discovered follow-ups as new items |
| User gave a design/code convention correction that was agreed and executed during this session | distill it via first-principles analysis and persist it to the correct layer (root `AGENTS.md` rules / package README / official domain file / skill) — merge into an existing entry when possible; one-off factual fixes do not qualify (see AGENTS.md「规范演进」) |
| New tooling, commands, or verification steps | the relevant section of `AGENTS.md` (keep it lean — links, not detail) |

Process docs (`docs/dev/{features,infra,bugfix,investigation}/...`) should already exist from the workflow; this skill only verifies they were placed there, never creates them retroactively.

## Writing rules

- `docs/official/` describes **current** conventions and contracts, not history or implementation narratives. Update in place; do not append changelog-style entries.
- Keep the single-source principle: a fact lives in exactly one layer — `AGENTS.md` (navigation + red lines) → `docs/official/` (cross-package truth) → package README (in-package rules). Everywhere else, link.
- When code and official docs disagree, treat it as a bug: either the doc is stale (fix it to match code) or the code violates a documented contract (flag it to the user instead of silently rewriting the doc).
- Do not retro-edit historical `docs/dev/` records to match later refactors; they are allowed to be stale. `docs/dev/backlog.md` is the exception — it is a live document.
- Respect each file's language and tone (official docs and READMEs are Chinese; this skill and AGENTS.md commands sections mix freely).

## Verification

- Re-read each edited section after writing to confirm it matches the actual code (open the referenced files when unsure).
- Ensure all relative links in edited sections resolve to existing files.
