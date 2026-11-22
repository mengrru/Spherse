export async function readOpfsJson<T>(filename: string, fallback: T): Promise<T> {
  const root = await navigator.storage.getDirectory();
  let fileHandle: FileSystemFileHandle;
  try {
    fileHandle = await root.getFileHandle(filename);
  } catch (err) {
    if ((err as DOMException)?.name === "NotFoundError") return fallback;
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
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(value, null, 2));
  await writable.close();
}
