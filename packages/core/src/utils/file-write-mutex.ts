export class FileWriteMutex {
  private queues: Map<string, Promise<void>> = new Map();

  async run<T>(absolutePath: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(absolutePath) ?? Promise.resolve();
    let resolve!: () => void;
    const next = new Promise<void>((r) => {
      resolve = r;
    });
    this.queues.set(absolutePath, next);

    try {
      await prev;
      return await fn();
    } finally {
      resolve();
      if (this.queues.get(absolutePath) === next) {
        this.queues.delete(absolutePath);
      }
    }
  }
}
