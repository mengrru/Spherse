# [Bugfix] Content Browser 从图片浏览切到其它 md 文件会特别卡（但关闭不卡）

## 问题描述

在 content browser 中查看大图（如 3.7MB PNG）后，通过文件树点击切换到另一个 md 文件时，界面明显卡顿。但直接关闭 content browser（返回 chat 页面）则不卡。

## 根因分析

**关键差异**：

- **关闭** content browser = 离开 `/content` 路由 → `showingContent` 变为 `false` → `<ContentBrowser>` **unmount**，浏览器在空闲时释放图片 bitmap
- **切换到 md 文件** = 留在 `/content` 路由，仅 `filePath` query param 变化 → `<ContentBrowser>` **复用**（同一 React 组件实例），`<img>` 从 DOM 移除但浏览器仍在后台处理大图解码后的 bitmap，同时 `react-markdown` 同步解析 MD AST

**三个叠加因素**：

1. **`<ContentBrowser>` 缺少 `key={contentPath}`**（`ProjectLayout.tsx:145`）— React 复用同一实例，没有干净的 mount/unmount 边界。大图 `<img>` 被替换为 markdown 内容时，React 必须对完全不同的 DOM tree 做 reconcile，而非先 unmount 再 mount
2. **大图 bitmap 未及时释放** — `<img>` 从 DOM 移除后，浏览器解码的数 MB bitmap 仍在 GPU/CPU 内存中，与 md 渲染争抢资源
3. **`MarkdownContent` 的 `components` 对象每次渲染重建**（`MarkdownContent.tsx:12-57`）— 定义在函数体内，每次 render 产生新引用，导致 `react-markdown` 认为组件映射变化而重渲染所有子节点

**触发链路**：

1. 用户在文件树点击 md 文件 → `navigate(buildContentUrl(...))` → URL query param `path` 变化
2. `contentPath` 变化 → `<ContentBrowser>` 重新渲染（但 **不** unmount/remount）
3. `useContentFile` 的 `useEffect` 触发 → fetch 新文件内容
4. `ContentView` 从渲染 `<img>`（图片分支）切换到渲染 `<MarkdownContent>`（md 分支）
5. 浏览器仍在后台持有大图 bitmap + `react-markdown` 同步解析 MD AST + React reconcile 完全不同的 DOM 结构 → 主线程阻塞

## 修复方案

### 改动 1：为 `<ContentBrowser>` 添加 `key={contentPath}`

文件：`packages/app/src/layouts/ProjectLayout.tsx`

```tsx
{showingContent && contentPath && (
  <ContentBrowser
    key={contentPath}
    client={project.ctx.client}
    filePath={contentPath}
    onBack={handleBackToChat}
    agents={agents}
    onStartSession={handleStartSession}
  />
)}
```

当 `contentPath` 变化时，React 会 unmount 旧 `ContentBrowser` 并 mount 新的。效果：
- 大图 `<img>` 被完整 unmount，浏览器更快释放解码后的 bitmap 内存
- 所有 hook state（编辑状态、冲突检测等）干净重置，无残留异步 effect
- 新文件获得全新的渲染周期，不与旧 DOM tree 做 reconcile

**已知副作用**：每次切换文件都重新 fetch content（但 `useContentFile` 本来就在 `filePath` 变化时重新 fetch，仅多出组件初始化开销）；非编辑态的滚动位置会丢失（可接受，切换文件后滚动位置本就应重置）。

### 改动 2：Memoize `MarkdownContent` 的 `components` 对象

文件：`packages/app/src/components/MarkdownContent.tsx`

将 `components` 对象从函数体内提取到模块级，按 `variant` 定义两个常量：

```tsx
const DOCUMENT_COMPONENTS: Components = {
  h1: ({ className, ...props }) => (
    <h1 className={cn("mt-6 mb-3 text-2xl", "font-semibold tracking-normal", className)} {...props} />
  ),
  // ...其余 document variant 组件
};

const CHAT_COMPONENTS: Components = {
  h1: ({ className, ...props }) => (
    <h1 className={cn("mt-2 mb-1 text-base", "font-semibold tracking-normal", className)} {...props} />
  ),
  // ...其余 chat variant 组件
};

export function MarkdownContent({ children, variant = "document" }: MarkdownContentProps) {
  const components = variant === "chat" ? CHAT_COMPONENTS : DOCUMENT_COMPONENTS;

  return (
    <div className={cn(compact ? "text-sm leading-6" : "text-sm leading-7")}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </Markdown>
    </div>
  );
}
```

避免每次渲染重建 `components` 对象，减少 `react-markdown` 的不必要重渲染。

## 行为变化

| 场景 | 修改前 | 修改后 |
|------|--------|--------|
| 图片 → md 文件切换 | 明显卡顿 | 流畅切换 |
| md → md 文件切换 | 正常 | 正常（重新 mount，滚动位置重置） |
| 图片 → 图片切换 | 正常 | 正常（重新 mount） |
| 关闭 content browser | 正常 | 不变 |
| 编辑中切换文件 | 有 unsaved changes 确认弹窗 | 不变（`ConfirmDialogs` 逻辑在 `ContentBrowser` 内部，随 unmount 被清理前已触发） |

## 影响范围

- `packages/app/src/layouts/ProjectLayout.tsx` — 添加 `key={contentPath}`（1 行）
- `packages/app/src/components/MarkdownContent.tsx` — 提取 `components` 为模块级常量

## 验证方式

1. 打开一个 3MB+ 图片 → 通过文件树切换到 md 文件 → 切换应流畅无卡顿
2. 打开 md 文件 → 切换到另一个 md 文件 → 正常显示，滚动位置从顶部开始
3. 打开图片 → 关闭 content browser → 行为不变
4. 编辑 md 文件（有未保存修改）→ 点击文件树切换文件 → 弹出 unsaved changes 确认弹窗 → 确认后正常切换
5. 在 chat 消息中的 markdown 渲染正常（`MarkdownContent` 改动影响 chat 和 document 两种 variant）
