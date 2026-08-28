import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const FILTERED_TYPES = new Set(["docs", "chore", "infra"]);
const BADGE_TYPES = new Set(["feat", "fix", "refactor", "test", "perf", "style"]);
const ENTRY_TYPE_PATTERN = /^([A-Za-z]+)(?::|：)\s*/;
const TRAILING_BY_LINK_PATTERN = /(?:^|\s)by\s+@[\w.-]+\s+in\s+https?:\/\/\S+\s*$/;
const TRAILING_LINK_PATTERN = /\s+in\s+https?:\/\/github\.com\/\S+\s*$/;

export function parseEntry(rawLine) {
  const line = rawLine.trim();
  if (!line.startsWith("* ")) return null;
  let rest = line.slice(2).trim();
  if (!rest) return null;
  let type = null;
  const typeMatch = ENTRY_TYPE_PATTERN.exec(rest);
  if (typeMatch) {
    const candidate = typeMatch[1].toLowerCase();
    if (FILTERED_TYPES.has(candidate)) return null;
    if (BADGE_TYPES.has(candidate)) {
      type = candidate;
      rest = rest.slice(typeMatch[0].length);
    }
  }
  rest = rest
    .replace(TRAILING_BY_LINK_PATTERN, "")
    .replace(TRAILING_LINK_PATTERN, "")
    .trim();
  if (!rest) return null;
  return { type, text: rest };
}

export function parseWhatChanged(body) {
  if (typeof body !== "string") return [];
  const notes = [];
  let inSection = false;
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      inSection = line.slice(3).trim() === "What's Changed";
      continue;
    }
    if (!inSection) continue;
    const entry = parseEntry(line);
    if (entry) notes.push(entry);
  }
  return notes;
}

function parseVersionSegments(tag) {
  const match = /^v?(\d+(?:\.\d+)*)$/.exec(tag.trim());
  if (!match) return null;
  return match[1].split(".").map(Number);
}

export function compareTagsDesc(a, b) {
  const sa = parseVersionSegments(a);
  const sb = parseVersionSegments(b);
  if (sa && sb) {
    const len = Math.max(sa.length, sb.length);
    for (let i = 0; i < len; i += 1) {
      const diff = (sa[i] ?? 0) - (sb[i] ?? 0);
      if (diff !== 0) return -diff;
    }
    return 0;
  }
  if (sa) return -1;
  if (sb) return 1;
  return 0;
}

export function transformReleases(releases) {
  return releases
    .filter(
      (release) =>
        release &&
        !release.draft &&
        !release.prerelease &&
        typeof release.tag_name === "string" &&
        release.tag_name.length > 0,
    )
    .map((release) => ({
      version: release.tag_name.replace(/^v/, ""),
      tag: release.tag_name,
      date:
        typeof release.published_at === "string"
          ? release.published_at.slice(0, 10)
          : null,
      notes: parseWhatChanged(release.body),
    }))
    .filter((release) => release.notes.length > 0)
    .toSorted((a, b) => compareTagsDesc(a.tag, b.tag));
}

export function buildChangelog(releases, now = new Date()) {
  return {
    generatedAt: now.toISOString(),
    releases: transformReleases(releases),
  };
}

export async function fetchAllPages(repo, { token, fetchImpl = globalThis.fetch } = {}) {
  if (!fetchImpl) throw new Error("fetch is unavailable");
  const all = [];
  let page = 1;
  for (;;) {
    const url = `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`;
    const res = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub API responded ${res.status} for releases page ${page}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error(`GitHub API returned non-array for releases page ${page}`);
    }
    all.push(...data);
    const link = res.headers?.get("link") ?? "";
    if (!link.includes('rel="next"')) break;
    page += 1;
  }
  return all;
}

function parseArgs(argv) {
  const args = { repo: undefined, output: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--repo") args.repo = argv[i + 1];
    else if (argv[i] === "--output") args.output = argv[i + 1];
  }
  return args;
}

async function main() {
  const { repo, output } = parseArgs(process.argv.slice(2));
  if (!repo) throw new Error("--repo owner/name is required");
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const releases = await fetchAllPages(repo, { token });
  const changelog = buildChangelog(releases);
  const json = `${JSON.stringify(changelog, null, 2)}\n`;
  if (output) {
    await writeFile(output, json, "utf8");
  } else {
    process.stdout.write(json);
  }
  process.stderr.write(
    `changelog: ${releases.length} releases -> ${changelog.releases.length} versions with notes\n`,
  );
}

const invokedAsCli = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href,
);

if (invokedAsCli) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
