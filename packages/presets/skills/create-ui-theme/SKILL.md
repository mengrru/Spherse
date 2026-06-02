---
name: create-ui-theme
description: 指导用户创建自定义 UI 主题，通过 .spherse/theme.css 覆盖 CSS 变量实现视觉定制
---

# 自定义 UI 主题

Spherse 支持通过项目级 CSS 变量覆盖来自定义 UI 外观。在项目根目录创建 `.spherse/theme.css`，覆盖对应的 CSS 变量即可生效。

## 可用变量

所有变量都支持浅色和深色两套值。只需覆盖你想修改的变量，未覆盖的保持默认。

### 页面与容器

| 变量 | 默认浅色 | 默认深色 | 用途 |
|------|----------|----------|------|
| `--shadcn-background` | `#fafafa` | `#171717` | 页面背景 |
| `--shadcn-foreground` | `#171717` | `#fafafa` | 页面主文字色 |
| `--shadcn-card` | `#ffffff` | `#262626` | 卡片/面板背景 |
| `--shadcn-card-foreground` | `#171717` | `#fafafa` | 卡片内文字色 |

### 弹出层

| 变量 | 默认浅色 | 默认深色 | 用途 |
|------|----------|----------|------|
| `--shadcn-popover` | `#ffffff` | `#262626` | 弹窗/下拉菜单背景 |
| `--shadcn-popover-foreground` | `#171717` | `#fafafa` | 弹窗内文字色 |

### 交互元素

| 变量 | 默认浅色 | 默认深色 | 用途 |
|------|----------|----------|------|
| `--shadcn-primary` | `#171717` | `#fafafa` | 主操作按钮背景、选中态 |
| `--shadcn-primary-foreground` | `#fafafa` | `#171717` | 主操作按钮文字色 |
| `--shadcn-secondary` | `#f5f5f5` | `#262626` | 次要按钮背景 |
| `--shadcn-secondary-foreground` | `#171717` | `#fafafa` | 次要按钮文字色 |
| `--shadcn-accent` | `#f5f5f5` | `#262626` | 悬停/选中背景 |
| `--shadcn-accent-foreground` | `#171717` | `#fafafa` | 悬停/选中文字色 |

### 文字层级

| 变量 | 默认浅色 | 默认深色 | 用途 |
|------|----------|----------|------|
| `--shadcn-muted` | `#f5f5f5` | `#262626` | 弱化背景 |
| `--shadcn-muted-foreground` | `#737373` | `#a3a3a3` | 次要/辅助文字色 |

### 边框与输入

| 变量 | 默认浅色 | 默认深色 | 用途 |
|------|----------|----------|------|
| `--shadcn-border` | `#e5e5e5` | `#404040` | 通用边框色 |
| `--shadcn-input` | `#e5e5e5` | `#404040` | 输入框边框色 |
| `--shadcn-ring` | `#a3a3a3` | `#737373` | 聚焦环色 |

### 语义色

| 变量 | 默认浅色 | 默认深色 | 用途 |
|------|----------|----------|------|
| `--shadcn-destructive` | `#dc2626` | `#f87171` | 危险/错误色 |

### 圆角

| 变量 | 默认值 | 用途 |
|------|--------|------|
| `--radius` | `0.5rem` | 全局圆角基数 |

### 侧边栏

| 变量 | 默认浅色 | 默认深色 | 用途 |
|------|----------|----------|------|
| `--shadcn-sidebar` | `#ffffff` | `#1f1f1f` | 侧边栏背景 |
| `--shadcn-sidebar-foreground` | `#171717` | `#fafafa` | 侧边栏文字色 |
| `--shadcn-sidebar-primary` | `#171717` | `#fafafa` | 侧边栏主要操作 |
| `--shadcn-sidebar-primary-foreground` | `#fafafa` | `#171717` | 侧边栏主要操作文字 |
| `--shadcn-sidebar-accent` | `#f5f5f5` | `#262626` | 侧边栏悬停/选中 |
| `--shadcn-sidebar-accent-foreground` | `#171717` | `#fafafa` | 侧边栏悬停文字 |
| `--shadcn-sidebar-border` | `#e5e5e5` | `#404040` | 侧边栏边框 |
| `--shadcn-sidebar-ring` | `#a3a3a3` | `#737373` | 侧边栏聚焦环 |

## 示例

### 暖色调主题

```css
/* .spherse/theme.css */
:root {
  --shadcn-background: #faf8f5;
  --shadcn-foreground: #3d2c1e;
  --shadcn-primary: #8b5e34;
  --shadcn-primary-foreground: #faf8f5;
  --shadcn-accent: #f0e6d8;
  --shadcn-accent-foreground: #3d2c1e;
  --shadcn-muted: #f0e6d8;
  --shadcn-muted-foreground: #8a7a68;
  --shadcn-border: #e0d5c8;
  --shadcn-card: #ffffff;
  --shadcn-popover: #ffffff;
}

@media (prefers-color-scheme: dark) {
  :root {
    --shadcn-background: #1a1612;
    --shadcn-foreground: #e8ddd0;
    --shadcn-primary: #d4a574;
    --shadcn-primary-foreground: #1a1612;
    --shadcn-accent: #2d2418;
    --shadcn-accent-foreground: #e8ddd0;
    --shadcn-muted: #2d2418;
    --shadcn-muted-foreground: #a0917e;
    --shadcn-border: #3d3228;
    --shadcn-card: #231e18;
    --shadcn-popover: #231e18;
  }
}
```

### 增大圆角

```css
/* .spherse/theme.css */
:root {
  --radius: 0.75rem;
}
```

## 注意事项

- 只覆盖你想修改的变量，其余保持默认
- 变量名必须与上表一致，不支持自定义变量名
- 深色模式值放在 `@media (prefers-color-scheme: dark)` 内的 `:root` 中
- 修改后刷新页面即可生效，无需重启应用
