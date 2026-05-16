# 用户自定义主题 (Custom Theme) 设计文档

## 概述

支持用户通过 `.spherse/theme.css` 文件覆盖默认 CSS 变量，实现主题定制。

## 加载时机

- 打开项目后，renderer 检查项目目录下是否存在 `.spherse/theme.css`
- 存在则注入到 `<head>`，不存在则跳过

## 实现方式

1. Renderer 获取当前项目路径
2. 检查 `.spherse/theme.css` 是否存在
3. 如存在，注入 `<link rel="stylesheet" href="path/.spherse/theme.css?t={mtime}">` 到 `<head>`
4. 加载失败时 console.warn，不影响主流程

## 目录结构

```
.spherse's directory/
├── theme.css          # 用户自定义主题文件
├── project.yaml
├── agents/
└── sessions.db
```

## 用户使用示例

`.spherse/theme.css`:
```css
:root {
  --accent: #ff6600;
  --primary: #222;
}
@media (prefers-color-scheme: dark) {
  :root {
    --accent: #ff8833;
  }
}
```

## 技术要点

- Cache-busting: 使用 `?t={mtime}` 避免浏览器缓存问题
- 错误处理: 静默失败，仅 console.warn
- 路径安全: 使用 ProjectStore 获取的 rootPath，确保在项目目录下

## 依赖

- packages/core/src/store/project.ts 已有的 `rootPath` 属性