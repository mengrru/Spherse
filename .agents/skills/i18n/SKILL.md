---
name: i18n
description: Guide for coding agents to migrate user-visible strings to the @spherse/i18n package and update locale catalogs
---

# i18n String Migration Skill

## Purpose

This skill guides the coding agent through identifying user-visible strings in Spherse source code, adding them to the shared `@spherse/i18n` locale catalogs, and replacing hardcoded text with `t()` calls.

## Scope

### What to translate

- React component text shown to users (buttons, labels, placeholders, error messages, empty states, dialog titles)
- Electron IPC error/confirmation messages shown to users
- Web shell UI (version guard, connect page)

### What NOT to translate

- Anything in `packages/server` or `packages/core` — they do NOT depend on `@spherse/i18n`. Server/core surface errors as structured codes (e.g. chat `ErrorEventCode`); the renderer owns the i18n rendering decision
- Route paths, query parameters, storage keys
- CSS class names, ARIA ids, test ids
- API endpoint paths
- Provider/model names and env key identifiers
- Console debug/log messages (unless also shown to users)
- Test data and test assertions
- File paths and technical identifiers
- Markdown content within project files (user content)

## Key Naming Convention

Use dot-path namespacing: `{domain}.{section}.{specific}`

Examples:
- `app.loading`
- `settings.title`
- `settings.models.defaultModel`
- `content.save.error`
- `chat.error.modelNotConfigured`
- `project.open.failed`

## Step-by-step Process

1. **Scan** the specified files or directories for user-visible string literals.

2. **Classify** each string: is it user-visible UI text or a technical string that should not be translated?

3. **Generate keys** for user-visible strings using the naming convention above. Keep keys stable and descriptive.

4. **Add entries** to all three locale files in `packages/i18n/src/locales/`:
   - `zh-CN.ts` — the canonical catalog (add as `as const`)
   - `zh-TW.ts` — Traditional Chinese translation
   - `en.ts` — English translation

5. **Replace** the hardcoded string in source code:
   - In React components: `const { t } = useI18n();` then `t("key")`
   - In Electron main / web shell: `translate(locale, "key", params)` (using locale from settings or provider)

6. **For strings with variables**: use `{name}` interpolation in the locale value, never concatenate translated parts:
   - ✅ `"无法读取文件：{path}"` + `t("key", { path })`
   - ❌ `"无法读取文件：" + path`

7. **Run validation**:
   ```bash
   npm run check:i18n
   ```
   Fix any key consistency or interpolation variable mismatches.

8. **Run build and tests**:
   ```bash
   npm run build
   npm test -w @spherse/i18n
   ```

9. **Report**: list all new/modified keys and any strings intentionally left untranslated with reasons.

## Catalog Location

- Locale files: `packages/i18n/src/locales/{zh-CN,zh-TW,en}.ts`
- Canonical catalog & `TranslationKey` derivation: `packages/i18n/src/catalog.ts`
- Translation API: `packages/i18n/src/translate.ts`

## Important Rules

- `zh-CN.ts` is the canonical source of truth for keys. All other locales must have identical key sets.
- Never edit `TranslationKey` type manually — it is derived from `zhCN` object keys.
- After adding keys, always run `npm run check:i18n` to verify consistency.
- Prefer semantic keys (`settings.title`) over structural keys (`dialog.header.text`).
