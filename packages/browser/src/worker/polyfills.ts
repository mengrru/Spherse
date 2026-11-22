const globalScope = globalThis as { Buffer?: unknown };

if (!globalScope.Buffer) {
  class BufferShim {
    static from(input: string | Uint8Array): Uint8Array {
      if (typeof input === "string") return new TextEncoder().encode(input);
      return input;
    }

    static isBuffer(value: unknown): boolean {
      return value instanceof Uint8Array;
    }
  }
  globalScope.Buffer = BufferShim;
}

export {};
