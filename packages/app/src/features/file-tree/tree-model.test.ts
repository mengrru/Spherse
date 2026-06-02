import { describe, expect, it } from "vitest";
import {
  buildNodes,
  mergeExpandedState,
  updateNode,
  type TreeNode,
} from "./tree-model";
import type { FileEntry } from "../../lib/types";

describe("buildNodes", () => {
  it("filters dotfiles and dotdirs", () => {
    const entries: FileEntry[] = [
      { name: ".hidden", type: "file" },
      { name: ".config", type: "directory" },
      { name: "README.md", type: "file" },
    ];
    const nodes = buildNodes(entries, "");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe("README.md");
  });

  it("sorts directories before files, then alphabetically", () => {
    const entries: FileEntry[] = [
      { name: "zebra.md", type: "file" },
      { name: "alpha", type: "directory" },
      { name: "beta.txt", type: "file" },
      { name: "gamma", type: "directory" },
    ];
    const nodes = buildNodes(entries, "");
    expect(nodes.map((n) => n.name)).toEqual(["alpha", "gamma", "beta.txt", "zebra.md"]);
  });

  it("builds paths with parent prefix", () => {
    const entries: FileEntry[] = [
      { name: "src", type: "directory" },
      { name: "index.ts", type: "file" },
    ];
    const nodes = buildNodes(entries, "project");
    expect(nodes[0].path).toBe("project/src");
    expect(nodes[1].path).toBe("project/index.ts");
  });

  it("returns empty array for empty input", () => {
    expect(buildNodes([], "")).toEqual([]);
  });
});

describe("updateNode", () => {
  const tree: TreeNode[] = [
    {
      name: "src",
      path: "src",
      type: "directory",
      expanded: false,
      loaded: true,
      children: [
        {
          name: "index.ts",
          path: "src/index.ts",
          type: "file",
          expanded: false,
          loaded: false,
          children: [],
        },
      ],
    },
    {
      name: "README.md",
      path: "README.md",
      type: "file",
      expanded: false,
      loaded: false,
      children: [],
    },
  ];

  it("updates a top-level node", () => {
    const result = updateNode(tree, "README.md", (n) => ({ ...n, expanded: true }));
    expect(result[1].expanded).toBe(true);
    expect(result[0].expanded).toBe(false);
  });

  it("updates a nested node", () => {
    const result = updateNode(tree, "src/index.ts", (n) => ({ ...n, expanded: true }));
    expect(result[0].children[0].expanded).toBe(true);
  });

  it("returns same reference for leaf nodes with no children", () => {
    const result = updateNode(tree, "README.md", (n) => ({ ...n, expanded: true }));
    expect(result[0].children[0]).toBe(tree[0].children[0]);
  });
});

describe("mergeExpandedState", () => {
  it("preserves expanded, loaded and children from old nodes", () => {
    const newNodes: TreeNode[] = [
      {
        name: "src",
        path: "src",
        type: "directory",
        expanded: false,
        loaded: false,
        children: [],
      },
    ];
    const oldNodes: TreeNode[] = [
      {
        name: "src",
        path: "src",
        type: "directory",
        expanded: true,
        loaded: true,
        children: [
          {
            name: "index.ts",
            path: "src/index.ts",
            type: "file",
            expanded: false,
            loaded: false,
            children: [],
          },
        ],
      },
    ];
    const result = mergeExpandedState(newNodes, oldNodes);
    expect(result[0].expanded).toBe(true);
    expect(result[0].loaded).toBe(true);
    expect(result[0].children).toBe(oldNodes[0].children);
  });

  it("returns new node as-is when no matching old node", () => {
    const newNodes: TreeNode[] = [
      {
        name: "new-dir",
        path: "new-dir",
        type: "directory",
        expanded: false,
        loaded: false,
        children: [],
      },
    ];
    const result = mergeExpandedState(newNodes, []);
    expect(result[0]).toBe(newNodes[0]);
  });

  it("preserves entire old subtree when old node is loaded", () => {
    const newNodes: TreeNode[] = [
      {
        name: "src",
        path: "src",
        type: "directory",
        expanded: false,
        loaded: false,
        children: [],
      },
    ];
    const oldNodes: TreeNode[] = [
      {
        name: "src",
        path: "src",
        type: "directory",
        expanded: true,
        loaded: true,
        children: [
          {
            name: "sub",
            path: "src/sub",
            type: "directory",
            expanded: true,
            loaded: true,
            children: [],
          },
        ],
      },
    ];
    const result = mergeExpandedState(newNodes, oldNodes);
    expect(result[0].children[0].expanded).toBe(true);
    expect(result[0].children[0].loaded).toBe(true);
    expect(result[0].children).toBe(oldNodes[0].children);
  });
});
