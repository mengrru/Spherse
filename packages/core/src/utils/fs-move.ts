import fs from "node:fs/promises";

export async function moveDirAtomic(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException | undefined)?.code !== "EXDEV") throw err;
    try {
      await fs.cp(src, dest, { recursive: true });
    } catch (cpErr) {
      await fs.rm(dest, { recursive: true, force: true });
      throw cpErr;
    }
    await fs.rm(src, { recursive: true, force: true });
  }
}
