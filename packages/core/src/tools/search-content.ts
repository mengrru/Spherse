import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AccessPolicy, AccessPolicyProvider } from "../access/access-policy.js";
import type { FsPort } from "../store/fs-port.js";
import { shouldSkipDirEntry } from "../utils/fs-walk.js";
import { resolveProjectPath, isProjectMetaPath } from "../utils/path-safety.js";
import { isBinaryBuffer } from "../utils/binary-detect.js";
import { PROJECT_META_DIR } from "../types.js";

const SearchContentParams = Type.Object({
  query: Type.String({ description: "Search query (substring match)" }),
  path: Type.Optional(Type.String({ description: "Directory path relative to project root. Defaults to project root." })),
  includePatterns: Type.Optional(Type.Array(Type.String(), { description: "File patterns to include, e.g. ['*.md', '*.txt']" })),
  include_meta: Type.Optional(Type.Boolean({
    description:
      "Whether to search inside the .spherse project-metadata directory. Default: false. .spherse stores agent definitions, session databases, skills, generated images, and project config. Keep the default unless you specifically need to inspect project metadata.",
    default: false,
  })),
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

function shouldSkipInSearch(name: string, includeMeta: boolean): boolean {
  if (name === PROJECT_META_DIR) return !includeMeta;
  return shouldSkipDirEntry(name);
}

interface SearchResult {
  file: string;
  line: number;
  text: string;
}

async function searchInFile(
  fsPort: FsPort,
  absPath: string,
  relPath: string,
  query: string,
  results: SearchResult[],
  maxResults: number,
): Promise<void> {
  if (results.length >= maxResults) return;

  let buf: Uint8Array;
  try {
    buf = await fsPort.readBinaryFile(relPath);
  } catch {
    return;
  }

  if (isBinaryBuffer(buf)) return;

  const content = new TextDecoder().decode(buf);
  const lines = content.split("\n");
  const lowerQuery = query.toLowerCase();

  for (let i = 0; i < lines.length && results.length < maxResults; i++) {
    if (lines[i].toLowerCase().includes(lowerQuery)) {
      results.push({
        file: absPath,
        line: i + 1,
        text: lines[i].trimEnd(),
      });
    }
  }
}

async function searchDir(
  fsPort: FsPort,
  relDir: string,
  query: string,
  includePatterns: string[] | undefined,
  results: SearchResult[],
  maxResults: number,
  projectRoot: string,
  policy: AccessPolicy,
  includeMeta: boolean,
): Promise<void> {
  if (results.length >= maxResults) return;

  const entries = await fsPort.readdir(relDir === "" ? "." : relDir);

  for (const entry of entries) {
    if (results.length >= maxResults) break;

    const entryRel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
    if (!policy.canRead(entryRel)) continue;

    if (entry.isDirectory) {
      if (shouldSkipInSearch(entry.name, includeMeta)) continue;
      await searchDir(
        fsPort,
        entryRel,
        query,
        includePatterns,
        results,
        maxResults,
        projectRoot,
        policy,
        includeMeta,
      );
    } else {
      if (!matchesPattern(entry.name, includePatterns)) continue;
      await searchInFile(fsPort, path.join(projectRoot, entryRel), entryRel, query, results, maxResults);
    }
  }
}

export function createSearchContentTool(
  projectRoot: string,
  fsPort: FsPort,
  getPolicy: AccessPolicyProvider,
): AgentTool<typeof SearchContentParams> {
  const root = path.resolve(projectRoot);
  const MAX_RESULTS = 100;

  return {
    name: "search_content",
    label: "Search Content",
    description: "Search file contents in the project for a query string. Returns matching file:line:text. Skips dotfiles, node_modules, and binary files. The .spherse metadata directory is excluded by default; set include_meta=true to search it.",
    parameters: SearchContentParams,
    async execute(_toolCallId, params, _signal) {
      const searchRel = params.path
        ? path.relative(root, resolveProjectPath(root, params.path)).split(path.sep).join("/")
        : "";
      const policy = getPolicy();
      const includeMeta = params.include_meta ?? false;

      if (params.path && !includeMeta && isProjectMetaPath(params.path)) {
        return {
          content: [{ type: "text" as const, text: `Set include_meta=true to search the ${PROJECT_META_DIR} directory.` }],
          details: { query: params.query, path: params.path, matches: 0, denied: true },
        };
      }

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

      if ((await fsPort.stat(searchRel === "" ? "." : searchRel)) === null) {
        return {
          content: [{ type: "text" as const, text: `Path not found: ${params.path ?? "/"}` }],
          details: { query: params.query, path: params.path, matches: 0 },
        };
      }

      const results: SearchResult[] = [];
      await searchDir(fsPort, searchRel, params.query, params.includePatterns, results, MAX_RESULTS, root, policy, includeMeta);

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
