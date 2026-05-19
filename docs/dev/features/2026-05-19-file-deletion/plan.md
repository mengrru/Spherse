# 文件删除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在文件浏览器中支持右键菜单删除文件和目录，保护 `.spherse/` 不被误删。

**Architecture:** Server 层新增 DELETE 路由处理文件/目录删除；API Client 新增 `deleteContent` 方法；FileTree 组件增加右键上下文菜单；ProjectPage 联动处理当前查看文件被删的情况。

**Tech Stack:** Fastify (server), React + TypeScript (frontend), Tailwind CSS v4

---

### Task 1: Server DELETE 路由

**Files:**
- Modify: `packages/server/src/routes/content.ts:64-65` (在文件末尾、函数关闭大括号前插入新路由)

- [ ] **Step 1: 在 `content.ts` 的 `registerContentRoutes` 函数末尾添加 DELETE 路由**

在 `packages/server/src/routes/content.ts` 第 64 行（函数末尾 `}` 之前）插入：

```ts
  fastify.delete<{ Params: { "*": string } }>(
    "/api/content/*",
    async (req, reply) => {
      const relativePath = req.params["*"];
      const absolutePath = path.resolve(
        ctx.projectStore.getRootPath(),
        relativePath,
      );

      if (!absolutePath.startsWith(ctx.projectStore.getRootPath())) {
        return reply.code(403).send({ error: "Access denied" });
      }

      if (relativePath === ".spherse" || relativePath.startsWith(".spherse/") || relativePath.startsWith(".spherse\\")) {
        return reply.code(403).send({ error: "Cannot delete .spherse directory" });
      }

      try {
        const stat = await fs.stat(absolutePath);
        if (stat.isDirectory()) {
          await fs.rm(absolutePath, { recursive: true });
        } else {
          await fs.unlink(absolutePath);
        }
        return { ok: true };
      } catch {
        return reply.code(404).send({ error: "Not found" });
      }
    },
  );
```

- [ ] **Step 2: 编译验证**

Run: `npm run build --workspace=packages/server`
Expected: 编译成功，无错误

---

### Task 2: API Client 新增 deleteContent 方法

**Files:**
- Modify: `packages/app/src/lib/api.ts:81` (在 `saveContent` 方法之后插入)

- [ ] **Step 1: 在 `api.ts` 的 `saveContent` 方法后（第 81 行之后）添加 `deleteContent` 方法**

```ts
    async deleteContent(filePath: string): Promise<{ ok: boolean }> {
      const res = await fetch(
        `${baseUrl}/api/content/${encodeURIComponent(filePath)}`,
        {
          method: "DELETE",
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        throw new Error(err.error ?? "request failed");
      }
      return res.json();
    },
```

- [ ] **Step 2: 编译验证**

Run: `npm run build --workspace=packages/app`
Expected: 编译成功，无错误

---

### Task 3: FileTree 右键上下文菜单

**Files:**
- Modify: `packages/app/src/components/FileTree.tsx` (完整重写)

这是最大的改动。需要：
1. 新增 `onDeleted` 回调 prop
2. 新增右键菜单状态（`contextMenu`：记录右键节点和鼠标位置）
3. 节点 `onContextMenu` 处理
4. 渲染上下文菜单（绝对定位 div）
5. 点击外部/ESC 关闭菜单
6. 删除确认 + 调用 API + 刷新

- [ ] **Step 1: 修改 FileTreeProps 接口，新增 `onDeleted`**

在 `packages/app/src/components/FileTree.tsx` 第 5-9 行，将接口替换为：

```ts
interface FileTreeProps {
  client: ApiClient;
  onSelectFile: (filePath: string) => void;
  onDeleted?: (path: string) => void;
  refreshKey?: number;
}
```

- [ ] **Step 2: 修改组件签名解构，新增 `onDeleted`**

将第 20 行：
```ts
export function FileTree({ client, onSelectFile, refreshKey }: FileTreeProps) {
```
替换为：
```ts
export function FileTree({ client, onSelectFile, onDeleted, refreshKey }: FileTreeProps) {
```

- [ ] **Step 3: 在组件内部 `nodesRef` 后添加右键菜单状态和 ref**

在第 22 行 `const nodesRef = useRef<TreeNode[]>([]);` 之后插入：

```ts
  const [contextMenu, setContextMenu] = useState<{ node: TreeNode; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 4: 添加右键菜单关闭逻辑的 useEffect**

在 `useFsWatchRefresh` 调用之前（第 95 行之前）插入：

```ts
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  const handleContextMenu = (e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    setContextMenu({ node, x: e.clientX, y: e.clientY });
  };

  const handleDelete = async () => {
    if (!contextMenu) return;
    const { node } = contextMenu;
    const label = node.type === "directory" ? `目录「${node.name}」` : `文件「${node.name}」`;
    const ok = window.confirm(`确定要删除${label}吗？此操作不可撤销。`);
    if (!ok) return;
    setContextMenu(null);
    try {
      await client.deleteContent(node.path);
      onDeleted?.(node.path);
      refreshExpanded(nodesRef.current).then(setRootNodes);
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };
```

- [ ] **Step 5: 修改 renderNode，添加 `onContextMenu`**

将第 97-116 行的 `renderNode` 函数替换为：

```tsx
  const renderNode = (node: TreeNode, depth: number = 0) => (
    <div key={node.path}>
      <div
        className="flex items-center py-[3px] px-1 rounded cursor-pointer transition-colors hover:bg-[var(--muted-bg)] select-none"
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => toggleNode(node)}
        onContextMenu={(e) => handleContextMenu(e, node)}
      >
        <span className="mr-1 text-xs">
          {node.type === "directory"
            ? node.expanded
              ? "📂"
              : "📁"
            : "📄"}
        </span>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">{node.name}</span>
      </div>
      {node.expanded &&
        node.children.map((child) => renderNode(child, depth + 1))}
    </div>
  );
```

- [ ] **Step 6: 修改 return 部分，添加上下文菜单渲染**

将第 118-126 行的 return 替换为：

```tsx
  return (
    <div className="text-[13px]">
      {rootNodes.length === 0 ? (
        <p className="text-xs text-[var(--faint)]">加载中...</p>
      ) : (
        rootNodes.map((node) => renderNode(node))
      )}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-surface border border-[var(--border)] rounded-md shadow-lg py-1 min-w-[120px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-[12px] text-danger hover:bg-[var(--hover)] transition-colors"
            onClick={handleDelete}
          >
            删除
          </button>
        </div>
      )}
    </div>
  );
```

- [ ] **Step 7: 编译验证**

Run: `npm run build --workspace=packages/app`
Expected: 编译成功，无错误

---

### Task 4: ProjectPage 联动

**Files:**
- Modify: `packages/app/src/pages/ProjectPage.tsx` (两处改动)

- [ ] **Step 1: 添加 `handleFileDeleted` 回调函数**

在 `handleBackToChat` 函数（第 126-128 行）之后插入：

```ts
  const handleFileDeleted = (deletedPath: string) => {
    if (selectedFile && (selectedFile === deletedPath || selectedFile.startsWith(deletedPath + "/"))) {
      setSelectedFile(null);
      setViewMode("chat");
    }
  };
```

- [ ] **Step 2: 传递 `onDeleted` 给 FileTree**

将第 277 行：
```tsx
          <FileTree client={ctx.client} onSelectFile={handleSelectFile} />
```
替换为：
```tsx
          <FileTree client={ctx.client} onSelectFile={handleSelectFile} onDeleted={handleFileDeleted} />
```

- [ ] **Step 3: 编译验证**

Run: `npm run build --workspace=packages/app`
Expected: 编译成功，无错误

---

### Task 5: 全量编译验证

- [ ] **Step 1: 执行完整 build**

Run: `npm run build`
Expected: 所有 workspace 编译成功

- [ ] **Step 2: 更新 backlog**

将 `docs/dev/backlog.md` 第 22 行的 `- [ ] **文件删除**` 改为 `- [x] **文件删除**`。
