function assertPath(path: string): void {
  if (typeof path !== "string") {
    throw new TypeError(`Path must be a string. Received ${JSON.stringify(path)}`);
  }
}

export const sep = "/";
export const delimiter = ":";

export function isAbsolute(path: string): boolean {
  assertPath(path);
  return path.length > 0 && path.charCodeAt(0) === 47;
}

export function normalize(path: string): string {
  assertPath(path);
  if (path.length === 0) return ".";
  const absolute = path.charCodeAt(0) === 47;
  const trailingSeparator = path.charCodeAt(path.length - 1) === 47;
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") {
        segments.pop();
      } else if (!absolute) {
        segments.push("..");
      }
      continue;
    }
    segments.push(segment);
  }
  let result = segments.join("/");
  if (absolute) result = `/${result}`;
  if (trailingSeparator && result.length > 0 && result.charCodeAt(result.length - 1) !== 47) {
    result += "/";
  }
  if (result.length === 0) return absolute ? "/" : ".";
  return result;
}

export function join(...paths: string[]): string {
  if (paths.length === 0) return ".";
  const nonEmpty: string[] = [];
  for (const p of paths) {
    assertPath(p);
    if (p.length > 0) nonEmpty.push(p);
  }
  if (nonEmpty.length === 0) return ".";
  return normalize(nonEmpty.join("/"));
}

export function resolve(...paths: string[]): string {
  let resolved = "";
  for (const p of paths) {
    assertPath(p);
    if (p.length === 0) continue;
    if (p.charCodeAt(0) === 47) {
      resolved = p;
    } else {
      resolved = resolved.length > 0 ? `${resolved}/${p}` : p;
    }
  }
  const normalized = normalize(resolved);
  if (normalized === "." || normalized === "./") return "/";
  if (normalized.charCodeAt(0) === 47) return normalized;
  return `/${normalized}`;
}

export function relative(from: string, to: string): string {
  assertPath(from);
  assertPath(to);
  const fromResolved = resolve(from);
  const toResolved = resolve(to);
  if (fromResolved === toResolved) return "";
  const fromSegments = fromResolved.split("/").filter((s) => s.length > 0);
  const toSegments = toResolved.split("/").filter((s) => s.length > 0);
  let common = 0;
  while (
    common < fromSegments.length &&
    common < toSegments.length &&
    fromSegments[common] === toSegments[common]
  ) {
    common += 1;
  }
  const parts: string[] = [];
  for (let i = common; i < fromSegments.length; i += 1) parts.push("..");
  parts.push(...toSegments.slice(common));
  return parts.length > 0 ? parts.join("/") : ".";
}

export function dirname(path: string): string {
  assertPath(path);
  const end = path.lastIndexOf("/");
  if (end === -1) return ".";
  if (end === 0) return "/";
  return path.slice(0, end);
}

export function basename(path: string, ext?: string): string {
  assertPath(path);
  const stripped = path.slice(path.lastIndexOf("/") + 1);
  if (ext !== undefined && ext.length > 0 && stripped.endsWith(ext) && stripped.length > ext.length) {
    return stripped.slice(0, stripped.length - ext.length);
  }
  return stripped;
}

export function extname(path: string): string {
  assertPath(path);
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "";
  if (dot === 0) return "";
  return base.slice(dot);
}

export function toNamespacedPath(path: string): string {
  return path;
}

export const posix = {
  sep,
  delimiter,
  isAbsolute,
  normalize,
  join,
  resolve,
  relative,
  dirname,
  basename,
  extname,
  toNamespacedPath,
};

export const win32 = {
  sep: "\\",
  delimiter: ";",
  isAbsolute(path: string): boolean {
    assertPath(path);
    return /^[a-zA-Z]:/.test(path) || /^[/\\]/.test(path);
  },
};

const pathApi = {
  sep,
  delimiter,
  isAbsolute,
  normalize,
  join,
  resolve,
  relative,
  dirname,
  basename,
  extname,
  toNamespacedPath,
  posix,
  win32,
};

export default pathApi;
