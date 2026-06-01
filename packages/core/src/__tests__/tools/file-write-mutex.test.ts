import { describe, it, expect } from "vitest";
import { FileWriteMutex } from "../../utils/file-write-mutex.js";

describe("FileWriteMutex", () => {
  it("serializes concurrent calls on the same path", async () => {
    const mutex = new FileWriteMutex();
    const order: number[] = [];

    const p1 = mutex.run("/a.txt", async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 50));
      order.push(2);
      return "r1";
    });
    const p2 = mutex.run("/a.txt", async () => {
      order.push(3);
      return "r2";
    });

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(order).toEqual([1, 2, 3]);
    expect(r1).toBe("r1");
    expect(r2).toBe("r2");
  });

  it("allows parallel calls on different paths", async () => {
    const mutex = new FileWriteMutex();
    const order: number[] = [];

    const p1 = mutex.run("/a.txt", async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 50));
      order.push(2);
    });
    const p2 = mutex.run("/b.txt", async () => {
      order.push(3);
      await new Promise((r) => setTimeout(r, 50));
      order.push(4);
    });

    await Promise.all([p1, p2]);

    expect(order).toEqual([1, 3, 2, 4]);
  });

  it("isolates exceptions — subsequent calls still execute", async () => {
    const mutex = new FileWriteMutex();

    const p1 = mutex.run("/a.txt", async () => {
      throw new Error("boom");
    });
    const p2 = mutex.run("/a.txt", async () => {
      return "ok";
    });

    await expect(p1).rejects.toThrow("boom");
    const r2 = await p2;
    expect(r2).toBe("ok");
  });

  it("cleans up queue entries after completion", async () => {
    const mutex = new FileWriteMutex();
    const queues = (mutex as any).queues as Map<string, unknown>;

    await mutex.run("/a.txt", async () => {});
    expect(queues.has("/a.txt")).toBe(false);

    const p1 = mutex.run("/b.txt", async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const p2 = mutex.run("/b.txt", async () => {});
    await Promise.all([p1, p2]);
    expect(queues.has("/b.txt")).toBe(false);
  });
});
