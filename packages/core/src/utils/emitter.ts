type Listener = (...args: unknown[]) => void;

export class Emitter {
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
    return () => this.off(event, listener);
  }

  off(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, ...args: unknown[]): boolean {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return false;
    for (const listener of [...set]) {
      listener(...args);
    }
    return true;
  }

  once(event: string, listener: Listener): () => void {
    const dispose = this.on(event, (...args) => {
      dispose();
      listener(...args);
    });
    return dispose;
  }

  removeAllListeners(event?: string): void {
    if (event === undefined) this.listeners.clear();
    else this.listeners.delete(event);
  }
}
