async function resolveOpfsFile(filename: string, create: boolean): Promise<FileSystemFileHandle> {
  const root = await navigator.storage.getDirectory();
  const segments = filename.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) throw new Error("opfs filename is empty");
  let dir: FileSystemDirectoryHandle = root;
  for (const segment of segments.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(segment, { create });
  }
  return dir.getFileHandle(segments[segments.length - 1], { create });
}

export async function readOpfsJson<T>(filename: string, fallback: T): Promise<T> {
  let fileHandle: FileSystemFileHandle;
  try {
    fileHandle = await resolveOpfsFile(filename, false);
  } catch (err) {
    const name = (err as DOMException)?.name;
    if (name === "NotFoundError" || name === "TypeMismatchError") return fallback;
    throw err;
  }
  const file = await fileHandle.getFile();
  const text = await file.text();
  if (text.trim().length === 0) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export async function writeOpfsJson(filename: string, value: unknown): Promise<void> {
  const fileHandle = await resolveOpfsFile(filename, true);
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(value, null, 2));
  await writable.close();
}
