---
name: create-agent-chat-theme
description: Use when creating or editing an agent-level Spherse chat window theme.css for custom chat backgrounds, headers, message bubbles, avatars, composer inputs, markdown blocks, or placeholder text.
---

# Agent Chat Theme

Agent chat themes live in the agent directory as `theme.css`. The app automatically scopes the file to the current chat window, so the CSS should target chat parts directly and should not wrap root styles in `[data-chat-root]`.

## Key Rules

| Goal | Use |
|------|-----|
| Chat root color variables | Bare CSS variable declarations at top level, one declaration per line |
| Chat root gradient/image background | Bare `background:` declaration at top level, one line |
| Header | `[data-chat-header]` |
| Message outer row | `[data-chat-message][data-role="user"]` or `assistant` |
| Actual message bubble | `[data-chat-message][data-role="user"] > div:first-child` |
| Assistant avatar | `[data-chat-message][data-role="assistant"]::before` |
| Composer outer area | `[data-chat-composer]` |
| Composer inner input frame | `[data-chat-composer] > div` |
| Textarea text | `[data-chat-composer] textarea` |
| Placeholder | `[data-chat-composer] textarea::placeholder` |

## Scope Gotchas

- Do not write `[data-chat-root] { ... }`; it will be scoped into `[data-chat-root] [data-chat-root]` and will not match.
- Root-level variables and background declarations must be written directly: `--shadcn-background: #0c0b12;`.
- Do not put gradients or images into `--shadcn-background`; use a top-level `background:` declaration for chat root visual backgrounds.
- Keep bare root declarations on one line. Multi-line `background:` declarations can be split incorrectly by the current scoping logic.
- Use English CSS function names: `radial-gradient`, not translated names.
- Do not define the same `::before` avatar rule twice unless the later one intentionally overrides the former.
- Assistant avatars are pure CSS pseudo-elements. The `::before` rule must include `content`, display/layout, width, height, margin, and `flex-shrink`; the app does not provide avatar sizing.

## Example

```css
--shadcn-background: #0c0b12;
--shadcn-foreground: #e2ddd4;
--shadcn-primary: #c9a04a;
--shadcn-primary-foreground: #0c0b12;
--shadcn-card: rgba(18, 17, 28, 0.88);
--shadcn-card-foreground: #e2ddd4;
--shadcn-border: rgba(201, 160, 74, 0.12);
--shadcn-muted-foreground: #7a7a8a;
--shadcn-input: rgba(93, 169, 179, 0.2);
--shadcn-ring: rgba(201, 160, 74, 0.4);
background: radial-gradient(ellipse at 20% 50%, rgba(201, 160, 74, 0.04) 0%, transparent 50%), linear-gradient(180deg, #0c0b12 0%, #11101a 50%, #0e0d16 100%);

[data-chat-header] {
  color: #e2ddd4;
  background: rgba(12, 11, 18, 0.92);
  border-color: rgba(201, 160, 74, 0.12);
}

[data-chat-message][data-role="assistant"] {
  position: relative;
}

[data-chat-message][data-role="assistant"]::before {
  content: '';
  display: block;
  width: 36px;
  height: 36px;
  margin-right: 8px;
  flex-shrink: 0;
  border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, #e2c87a 0%, #c9a04a 40%, #8a6a2a 100%);
  box-shadow: 0 0 12px rgba(201, 160, 74, 0.3), inset 0 -2px 4px rgba(0, 0, 0, 0.3);
}

[data-chat-message][data-role="user"] > div:first-child {
  color: #0c0b12;
  background: linear-gradient(135deg, #c9a04a 0%, #b8893a 100%);
  border-radius: 18px 18px 4px 18px;
}

[data-chat-message][data-role="assistant"] > div:first-child {
  color: #e2ddd4;
  background: rgba(24, 23, 36, 0.9);
  border: 1px solid rgba(201, 160, 74, 0.08);
  border-radius: 18px 18px 18px 4px;
}

[data-chat-composer] {
  background: rgba(12, 11, 18, 0.92);
  border-top: 1px solid rgba(201, 160, 74, 0.08);
}

[data-chat-composer] > div {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(201, 160, 74, 0.08);
}

[data-chat-composer] textarea {
  color: #e2ddd4;
}

[data-chat-composer] textarea::placeholder {
  color: #7a7a8a;
}
```

## Common Mistakes

- Styling `[data-chat-message]` when you meant the bubble. Use `> div:first-child` for bubble shape, background, and text color.
- Styling `[data-chat-composer]` when you meant the input frame. Use `[data-chat-composer] > div` for border/background around the textarea.
- Keeping sidebar variables in an agent theme. Agent themes only affect the chat window, not the project sidebar.
