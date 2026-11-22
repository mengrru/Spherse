import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionStorePort } from "../../store/session-port.js";
import type { MemoryStorePort } from "../../store/memory-port.js";
import type { SessionEvent } from "../../session/events.js";

function userMsg(text: string, timestamp: number): AgentMessage {
  return { role: "user", content: text, timestamp } as AgentMessage;
}

function assistantMsg(text: string, timestamp: number): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    timestamp,
  } as unknown as AgentMessage;
}

export interface SessionStoreContractSubject {
  store: SessionStorePort;
  close: () => void | Promise<void>;
}

export function runSessionStorePortContract(
  subjectName: string,
  createSubject: () => SessionStoreContractSubject | Promise<SessionStoreContractSubject>,
): void {
  describe(`SessionStorePort contract: ${subjectName}`, () => {
    let subject: SessionStoreContractSubject;

    const append = (
      sessionId: string,
      events: Array<Omit<SessionEvent, "seq"> & { seq?: number }>,
    ) => {
      subject.store.appendEvents(
        sessionId,
        events.map((event, index) => ({ seq: event.seq ?? index, ...event }) as SessionEvent),
        1,
      );
    };

    describe("appendEvents", () => {
      beforeEach(async () => {
        subject = await createSubject();
      });

      it("rejects a first batch that does not start at seq 0", () => {
        const id = subject.store.createSession();
        expect(() =>
          subject.store.appendEvents(
            id,
            [{ seq: 1, type: "turn/start", time: 1, data: {} }],
            1,
          ),
        ).toThrow();
      });

      it("rejects seq gaps inside a batch", () => {
        const id = subject.store.createSession();
        expect(() =>
          subject.store.appendEvents(
            id,
            [
              { seq: 0, type: "turn/start", time: 1, data: {} },
              { seq: 2, type: "user/message", time: 2, data: { message: userMsg("x", 2) } },
            ],
            1,
          ),
        ).toThrow();
      });

      it("advances updated_at on append", () => {
        const id = subject.store.createSession("t");
        const before = subject.store.getSession(id)!.updatedAt;
        append(id, [{ type: "turn/start", time: Date.now() + 10, data: {} }]);
        const after = subject.store.getSession(id)!.updatedAt;
        expect(after).toBeGreaterThanOrEqual(before);
      });

      it("keeps the previous batch intact when the next batch violates seq continuity", () => {
        const id = subject.store.createSession();
        append(id, [{ type: "turn/start", time: 1, data: {} }]);
        expect(() =>
          subject.store.appendEvents(
            id,
            [{ seq: 5, type: "user/message", time: 2, data: { message: userMsg("x", 2) } }],
            1,
          ),
        ).toThrow();
        expect(subject.store.readEventCount(id)).toBe(1);
        expect(subject.store.maxSeq(id)).toBe(0);
      });

      it("accepts a follow-up batch continuing at maxSeq + 1", () => {
        const id = subject.store.createSession();
        append(id, [
          { type: "turn/start", time: 1, data: {} },
          { type: "user/message", time: 2, data: { message: userMsg("hello", 2) } },
        ]);
        subject.store.appendEvents(
          id,
          [{ seq: 2, type: "assistant/message", time: 3, data: { message: assistantMsg("hi", 3) } }],
          1,
        );
        expect(subject.store.readEventCount(id)).toBe(3);
        expect(subject.store.maxSeq(id)).toBe(2);
      });
    });

    describe("readEventsAfter", () => {
      beforeEach(async () => {
        subject = await createSubject();
      });

      it("returns events strictly after since in ascending seq order", () => {
        const id = subject.store.createSession();
        append(id, [
          { type: "turn/start", time: 1, data: {} },
          { type: "user/message", time: 2, data: { message: userMsg("a", 2) } },
          { type: "assistant/message", time: 3, data: { message: assistantMsg("b", 3) } },
        ]);
        const events = subject.store.readEventsAfter(id, 0, 10);
        expect(events.map((event) => event.seq)).toEqual([1, 2]);
      });
    });

    describe("searchMessages", () => {
      beforeEach(async () => {
        subject = await createSubject();
      });

      it("matches ascii case-insensitively", () => {
        const id = subject.store.createSession("searchable");
        append(id, [{ type: "user/message", time: 1, data: { message: userMsg("Find The Needle", 1) } }]);
        const hits = subject.store.searchMessages("needle", 100);
        expect(hits.length).toBe(1);
        expect(hits[0].sessionId).toBe(id);
        const upper = subject.store.searchMessages("NEEDLE", 100);
        expect(upper.length).toBe(1);
      });

      it("matches non-ascii substrings exactly", () => {
        const id = subject.store.createSession("zh");
        append(id, [{ type: "user/message", time: 1, data: { message: userMsg("规划巴黎的旅程", 1) } }]);
        const hits = subject.store.searchMessages("旅程", 100);
        expect(hits.length).toBe(1);
        expect(hits[0].sessionId).toBe(id);
        expect(subject.store.searchMessages("旅成", 100)).toEqual([]);
      });
    });

    describe("legacy migration group", () => {
      beforeEach(async () => {
        subject = await createSubject();
      });

      it("migrates a strictly zero-based batch once and marks migrated", () => {
        const id = subject.store.createSession("legacy");
        subject.store.migrateEvents(
          id,
          [{ seq: 0, type: "turn/start", time: 1, data: {} }],
          1,
        );
        expect(subject.store.isMigrated(id)).toBe(true);
        expect(() =>
          subject.store.migrateEvents(id, [{ seq: 0, type: "turn/start", time: 1, data: {} }], 1),
        ).toThrow();
      });

      it("rejects migration batches containing gaps", () => {
        const id = subject.store.createSession("gap");
        expect(() =>
          subject.store.migrateEvents(
            id,
            [
              { seq: 0, type: "turn/start", time: 1, data: {} },
              { seq: 2, type: "user/message", time: 2, data: { message: userMsg("x", 2) } },
            ],
            1,
          ),
        ).toThrow();
      });
    });

    describe("session lifecycle", () => {
      beforeEach(async () => {
        subject = await createSubject();
      });

      it("lists, renames and archives sessions", () => {
        const id = subject.store.createSession("first");
        subject.store.createSession("second");
        expect(subject.store.listSessions().length).toBe(2);
        subject.store.updateSessionTitle(id, "renamed");
        expect(subject.store.getSession(id)!.title).toBe("renamed");
        subject.store.archiveSession(id);
        expect(subject.store.listSessions().length).toBe(1);
        expect(subject.store.listSessionsPage(10, 0).items.length).toBe(1);
      });
    });

    afterEach(async () => {
      await subject.close();
    });
  });
}

export interface MemoryStoreContractSubject {
  store: MemoryStorePort;
  close: () => void | Promise<void>;
}

export function runMemoryStorePortContract(
  subjectName: string,
  createSubject: () => MemoryStoreContractSubject | Promise<MemoryStoreContractSubject>,
): void {
  describe(`MemoryStorePort contract: ${subjectName}`, () => {
    let subject: MemoryStoreContractSubject;

    beforeEach(async () => {
      subject = await createSubject();
    });

    it("saves, lists, counts, updates and deletes entries", () => {
      const saved = subject.store.save("remember the milk", ["errand"]);
      expect(subject.store.count()).toBe(1);
      expect(subject.store.list()[0].content).toBe("remember the milk");
      const updated = subject.store.update(saved.id, { content: "remember the oats" });
      expect(updated.content).toBe("remember the oats");
      subject.store.deleteEntry(saved.id);
      expect(subject.store.count()).toBe(0);
    });

    it("searches ascii case-insensitively over the hit set", () => {
      subject.store.save("Grocery PLAN for the week");
      subject.store.save("unrelated note");
      const hits = subject.store.search("grocery plan", 10);
      expect(hits.length).toBe(1);
      expect(hits[0].content).toBe("Grocery PLAN for the week");
    });

    it("matches non-ascii search terms exactly", () => {
      subject.store.save("巴黎行程安排");
      subject.store.save("东京行程安排");
      const hits = subject.store.search("巴黎", 10);
      expect(hits.length).toBe(1);
      expect(hits[0].content).toBe("巴黎行程安排");
    });

    it("maintains the core document through save and append", async () => {
      await subject.store.saveCore("# Core\n");
      const appended = await subject.store.appendCore("- one\n");
      expect(appended).toContain("- one");
      expect(await subject.store.getCore()).toContain("# Core");
      expect(await subject.store.getCore()).toContain("- one");
    });

    afterEach(async () => {
      await subject.close();
    });
  });
}
