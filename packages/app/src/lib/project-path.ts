function normalizeSeparators(p: string): string {
  return p.replace(/\\/g, "/");
}

interface ParsedPath {
  root: string;
  segments: string[];
  caseInsensitive: boolean;
}

function parsePath(input: string): ParsedPath {
  const p = normalizeSeparators(input);
  let root = "";
  let rest = p;
  let caseInsensitive = false;

  const drive = /^([a-zA-Z]:)(\/?)(.*)$/.exec(p);
  if (drive) {
    root = drive[1].toUpperCase() + "/";
    rest = drive[3];
    caseInsensitive = true;
  } else if (p.startsWith("//")) {
    const parts = p.slice(2).split("/");
    root = `//${(parts[0] ?? "").toLowerCase()}/${(parts[1] ?? "").toLowerCase()}`;
    rest = parts.slice(2).join("/");
    caseInsensitive = true;
  } else if (p.startsWith("/")) {
    root = "/";
    rest = p.slice(1);
  }

  const segments: string[] = [];
  for (const seg of rest.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      segments.pop();
      continue;
    }
    segments.push(seg);
  }

  return { root, segments, caseInsensitive };
}

function sameSegment(a: string, b: string, caseInsensitive: boolean): boolean {
  return caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function isPathInsideProject(projectRoot: string, absPath: string): boolean {
  const root = parsePath(projectRoot);
  const target = parsePath(absPath);

  if (root.root !== target.root) return false;
  if (root.segments.length > target.segments.length) return false;

  const caseInsensitive = root.caseInsensitive || target.caseInsensitive;
  for (let i = 0; i < root.segments.length; i++) {
    if (!sameSegment(root.segments[i], target.segments[i], caseInsensitive)) return false;
  }
  return true;
}

export function toProjectRelative(projectRoot: string, absPath: string): string {
  if (!isPathInsideProject(projectRoot, absPath)) {
    throw new Error(`Path is outside the project directory: ${absPath}`);
  }
  const root = parsePath(projectRoot);
  const target = parsePath(absPath);
  return target.segments.slice(root.segments.length).join("/");
}

export function joinProjectPath(projectRoot: string, ...segments: string[]): string {
  const normalized = segments.map(normalizeSeparators);
  const joined = normalizeSeparators(projectRoot) + "/" + normalized.join("/");
  const parsed = parsePath(joined);
  const result = parsed.root === "" ? "/" + parsed.segments.join("/") : parsed.root + parsed.segments.join("/");
  if (!isPathInsideProject(projectRoot, result)) {
    throw new Error(`joinProjectPath produced a path outside the project: ${result}`);
  }
  return result;
}
