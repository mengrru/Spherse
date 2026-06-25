import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { AccessPolicy } from "../access/access-policy.js";
import { shouldSkipDirEntry } from "../utils/fs-walk.js";
import { resolveProjectPath } from "../utils/path-safety.js";

type AccessPolicyProvider = () => AccessPolicy;

const SearchContentParams = Type.Object({
  query: Type.String({ description: "Search query (substring match)" }),
  path: Type.Optional(Type.String({ description: "Directory path relative to project root. Defaults to project root." })),
  includePatterns: Type.Optional(Type.Array(Type.String(), { description: "File patterns to include, e.g. ['*.md', '*.txt']" })),
});

function matchesPattern(fileName: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return true;
  return patterns.some((pattern) => {
    const regex = globToRegex(pattern);
    return regex.test(fileName);
  });
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

interface SearchResult {
  file: string;
  line: number;
  text: string;
}

async function searchInFile(
  filePath: string,
  query: string,
  results: SearchResult[],
  maxResults: number,
): Promise<void> {
  if (results.length >= maxResults) return;

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return;
  }

  const lines = content.split("\n");
  const lowerQuery = query.toLowerCase();

  for (let i = 0; i < lines.length && results.length < maxResults; i++) {
    if (lines[i].toLowerCase().includes(lowerQuery)) {
      results.push({
        file: filePath,
        line: i + 1,
        text: lines[i].trimEnd(),
      });
    }
  }
}

async function searchDir(
  dirPath: string,
  query: string,
  includePatterns: string[] | undefined,
  results: SearchResult[],
  maxResults: number,
  projectRoot: string,
  policy: AccessPolicy,
): Promise<void> {
  if (results.length >= maxResults) return;

  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (results.length >= maxResults) break;

    const entryPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(projectRoot, entryPath).split(path.sep).join("/");
    if (!policy.canRead(relativePath)) continue;

    if (entry.isDirectory()) {
      if (shouldSkipDirEntry(entry.name)) continue;
      await searchDir(
        entryPath,
        query,
        includePatterns,
        results,
        maxResults,
        projectRoot,
        policy,
      );
    } else if (entry.isFile()) {
      if (!matchesPattern(entry.name, includePatterns)) continue;
      await searchInFile(entryPath, query, results, maxResults);
    }
  }
}

export function createSearchContentTool(
  projectRoot: string,
  getPolicy: AccessPolicyProvider,
): AgentTool<typeof SearchContentParams> {
  const root = path.resolve(projectRoot);
  const MAX_RESULTS = 100;

  return {
    name: "search_content",
    label: "Search Content",
    description: "Search file contents in the project for a query string. Returns matching file:line:text. Skips dotfiles and node_modules.",
    parameters: SearchContentParams,
    async execute(_toolCallId, params, _signal) {
      const searchPath = params.path ? resolveProjectPath(root, params.path) : root;
      const policy = getPolicy();

      if (params.path) {
        try {
          policy.assertRead(params.path);
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: (err as Error).message }],
            details: { query: params.query, path: params.path, matches: 0, denied: true },
          };
        }
      }

      if (!fsSync.existsSync(searchPath)) {
        return {
          content: [{ type: "text" as const, text: `Path not found: ${params.path ?? "/"}` }],
          details: { query: params.query, path: params.path, matches: 0 },
        };
      }

      const results: SearchResult[] = [];
      await searchDir(searchPath, params.query, params.includePatterns, results, MAX_RESULTS, root, policy);

      const text = results.length > 0
        ? results.map((r) => `${r.file}:${r.line}: ${r.text}`).join("\n")
        : `No matches found for "${params.query}"`;

      return {
        content: [{ type: "text" as const, text }],
        details: { query: params.query, matches: results.length, truncated: results.length >= MAX_RESULTS },
      };
    },
  };
}
