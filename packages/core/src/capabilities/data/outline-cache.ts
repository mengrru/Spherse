export class OutlineCache {
  private readonly map = new Map<string, string>();
  constructor(private readonly capacity = 64) {}

  private key(absolutePath: string, version: string): string {
    return `${absolutePath}\0${version}`;
  }

  get(absolutePath: string, version: string): string | undefined {
    const key = this.key(absolutePath, version);
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(absolutePath: string, version: string, outline: string): void {
    const key = this.key(absolutePath, version);
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, outline);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  invalidateFile(absolutePath: string): void {
    const prefix = `${absolutePath}\0`;
    for (const key of this.map.keys()) {
      if (key.startsWith(prefix)) this.map.delete(key);
    }
  }
}
