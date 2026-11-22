import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionInfo } from "../types.js";
import type { SessionEvent } from "../session/events.js";
import { collectAbandonedSeqs } from "../session/fold.js";
import { matchMessageData, type MessageSearchHit } from "../session/search.js";
import type { Logger } from "../logger.js";
import type { SessionChangeAction, SessionChangePayload, SessionStorePort } from "./session-port.js";
import { parseAgentMessageContent } from "./session-port.js";
import { openDatabase, requestAsPromise } from "./idb-util.js";

type MessageWithId = { id: number; message: AgentMessage };

interface SessionRecord {
  id: string;
  agentId: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  status: string;
  source: string | null;
  migratedAt?: number;
}

interface EventRecord {
  sessionId: string;
  seq: number;
  type: string;
  data: string;
  time: number;
  schemaVersion: number;
}

interface MessageRecord {
  id: number;
  sessionId: string;
  role: string;
  content: string;
  timestamp: number;
  schemaVersion: number;
}

interface CompactionRecord {
  id: number;
  sessionId: string;
  anchorMessageId: number;
  digestContent: string;
  tokenEstimate: number;
  createdAt: number;
}

const noopLogger: Logger = {
  level: "silent",
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  child: () => noopLogger,
} as unknown as Logger;

export class IdbSessionStore implements SessionStorePort {
  private readonly agentId: string;
  private readonly db: IDBDatabase;
  private readonly logger: Logger;
  private readonly onSessionChange?: (payload: SessionChangePayload) => void;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly events = new Map<string, EventRecord[]>();
  private readonly messages = new Map<string, MessageRecord[]>();
  private readonly compactions = new Map<string, CompactionRecord[]>();
  private nextMessageId = 1;
  private nextCompactionId = 1;

  private constructor(agentId: string, db: IDBDatabase, logger?: Logger, onSessionChange?: (payload: SessionChangePayload) => void) {
    this.agentId = agentId;
    this.db = db;
    this.logger = logger ?? noopLogger;
    this.onSessionChange = onSessionChange;
  }

  static async open(
    storeKey: string,
    agentId: string,
    logger?: Logger,
    onSessionChange?: (payload: SessionChangePayload) => void,
  ): Promise<IdbSessionStore> {
    const db = await openDatabase(`spherse-sessions:${storeKey}`, 1, (db) => {
      if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("events")) {
        db.createObjectStore("events", { keyPath: ["sessionId", "seq"] });
      }
      if (!db.objectStoreNames.contains("messages")) {
        const messages = db.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
        messages.createIndex("bySession", "sessionId");
      }
      if (!db.objectStoreNames.contains("compactions")) {
        const compactions = db.createObjectStore("compactions", { keyPath: "id", autoIncrement: true });
        compactions.createIndex("bySession", "sessionId");
      }
    });
    const store = new IdbSessionStore(agentId, db, logger, onSessionChange);
    await store.load();
    return store;
  }

  private async load(): Promise<void> {
    await this.loadStore<SessionRecord>("sessions", (row) => {
      this.sessions.set(row.id, row);
    });
    await this.loadStore<EventRecord>("events", (row) => {
      const list = this.events.get(row.sessionId) ?? [];
      list.push(row);
      this.events.set(row.sessionId, list);
    });
    await this.loadStore<MessageRecord>("messages", (row) => {
      const list = this.messages.get(row.sessionId) ?? [];
      list.push(row);
      this.messages.set(row.sessionId, list);
      this.nextMessageId = Math.max(this.nextMessageId, row.id + 1);
    });
    await this.loadStore<CompactionRecord>("compactions", (row) => {
      const list = this.compactions.get(row.sessionId) ?? [];
      list.push(row);
      this.compactions.set(row.sessionId, list);
      this.nextCompactionId = Math.max(this.nextCompactionId, row.id + 1);
    });
    for (const list of this.events.values()) list.sort((a, b) => a.seq - b.seq);
    for (const list of this.messages.values()) list.sort((a, b) => a.id - b.id);
    for (const list of this.compactions.values()) list.sort((a, b) => a.id - b.id);
  }

  private async loadStore<T>(storeName: string, accept: (row: T) => void): Promise<void> {
    const tx = this.db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).getAll();
    const rows = await requestAsPromise(request as IDBRequest<T[]>);
    for (const row of rows) accept(row);
  }

  private persist<T>(storeName: string, value: T): void {
    try {
      const tx = this.db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value);
    } catch (err) {
      this.logger.warn({ err, storeName }, "idb persist failed");
    }
  }

  private persistDelete(storeName: string, key: IDBValidKey): void {
    try {
      const tx = this.db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(key);
    } catch (err) {
      this.logger.warn({ err, storeName }, "idb persist delete failed");
    }
  }

  private emitSessionChange(sessionId: string, action: SessionChangeAction): void {
    this.onSessionChange?.({ agentId: this.agentId, sessionId, action });
  }

  private static toSessionInfo(row: SessionRecord): SessionInfo {
    return {
      id: row.id,
      agentId: row.agentId,
      title: row.title ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      status: row.status as SessionInfo["status"],
      source: (row.source ?? "manual") as SessionInfo["source"],
    };
  }

  close(): void {
    this.db.close();
  }

  createSession(title?: string, source?: string): string {
    const id = crypto.randomUUID();
    const now = Date.now();
    const record: SessionRecord = {
      id,
      agentId: this.agentId,
      title: title ?? null,
      createdAt: now,
      updatedAt: now,
      status: "active",
      source: source ?? "manual",
    };
    this.sessions.set(id, record);
    this.persist("sessions", record);
    this.emitSessionChange(id, "created");
    return id;
  }

  getSession(id: string): SessionInfo | null {
    const row = this.sessions.get(id);
    return row ? IdbSessionStore.toSessionInfo(row) : null;
  }

  private activeSessionsSorted(): SessionRecord[] {
    return [...this.sessions.values()]
      .filter((row) => row.agentId === this.agentId && row.status === "active")
      .sort((a, b) => (b.updatedAt - a.updatedAt) || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0));
  }

  listSessions(): SessionInfo[] {
    return this.activeSessionsSorted().map(IdbSessionStore.toSessionInfo);
  }

  listSessionsPage(limit: number, offset: number): { items: SessionInfo[]; hasMore: boolean } {
    const rows = this.activeSessionsSorted().slice(offset, offset + limit + 1);
    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    return { items: sliced.map(IdbSessionStore.toSessionInfo), hasMore };
  }

  updateSessionTitle(sessionId: string, title: string): void {
    const row = this.sessions.get(sessionId);
    if (!row) return;
    row.title = title;
    this.persist("sessions", row);
    this.emitSessionChange(sessionId, "updated");
  }

  archiveSession(sessionId: string): void {
    const row = this.sessions.get(sessionId);
    if (!row) return;
    row.status = "archived";
    this.persist("sessions", row);
    this.emitSessionChange(sessionId, "deleted");
  }

  appendEvents(sessionId: string, events: ReadonlyArray<SessionEvent>, schemaVersion: number): void {
    if (events.length === 0) return;
    const existing = this.events.get(sessionId) ?? [];
    const expectedFirstSeq = existing.length > 0 ? existing[existing.length - 1].seq + 1 : 0;
    if (events[0].seq !== expectedFirstSeq) {
      throw new Error(`Event seq must continue at ${expectedFirstSeq} for session ${sessionId}`);
    }
    for (const [index, event] of events.entries()) {
      if (event.seq !== expectedFirstSeq + index) {
        throw new Error(`Event batch contains a seq gap for session ${sessionId}`);
      }
    }
    const records = events.map((event) => ({
      sessionId,
      seq: event.seq,
      type: event.type,
      data: JSON.stringify(event.data),
      time: event.time,
      schemaVersion,
    }));
    this.events.set(sessionId, [...existing, ...records]);
    for (const record of records) this.persist("events", record);
    const session = this.sessions.get(sessionId);
    if (session) {
      session.updatedAt = Date.now();
      this.persist("sessions", session);
    }
    this.logger.debug({ sessionId, count: events.length }, "events appended");
  }

  private eventsOf(sessionId: string): EventRecord[] {
    return this.events.get(sessionId) ?? [];
  }

  private static toEvents(rows: EventRecord[]): SessionEvent[] {
    return rows.map((row) => ({
      type: row.type as SessionEvent["type"],
      seq: row.seq,
      time: row.time,
      data: JSON.parse(row.data),
    }) as SessionEvent);
  }

  readEvents(sessionId: string): SessionEvent[] {
    return IdbSessionStore.toEvents(this.eventsOf(sessionId));
  }

  readEventsAfter(sessionId: string, sinceSeq: number, limit: number): SessionEvent[] {
    return IdbSessionStore.toEvents(
      this.eventsOf(sessionId).filter((row) => row.seq > sinceSeq).slice(0, limit),
    );
  }

  readEventCount(sessionId: string): number {
    return this.eventsOf(sessionId).length;
  }

  maxSeq(sessionId: string): number | null {
    const rows = this.eventsOf(sessionId);
    return rows.length > 0 ? rows[rows.length - 1].seq : null;
  }

  searchMessages(query: string, prefetchLimit: number): MessageSearchHit[] {
    const trimmed = query.trim();
    if (!trimmed || prefetchLimit <= 0) return [];
    const lowered = trimmed.toLowerCase();
    const candidates: Array<{ row: EventRecord; title: string | null }> = [];
    for (const row of this.allMessageEvents()) {
      const session = this.sessions.get(row.sessionId);
      if (!session || session.status !== "active") continue;
      if (!row.data.toLowerCase().includes(lowered)) continue;
      candidates.push({ row, title: session.title });
    }
    candidates.sort((a, b) => (b.row.time - a.row.time) || (b.row.seq - a.row.seq));
    const limited = candidates.slice(0, prefetchLimit);
    if (limited.length === 0) return [];

    const hits: MessageSearchHit[] = [];
    const sessionsWithHits = new Set<string>();
    for (const candidate of limited) {
      const match = matchMessageData(trimmed, candidate.row.data);
      if (!match) continue;
      hits.push({
        sessionId: candidate.row.sessionId,
        ...(candidate.title != null ? { sessionTitle: candidate.title } : {}),
        seq: candidate.row.seq,
        role: match.role,
        snippet: match.snippet,
        time: candidate.row.time,
      });
      sessionsWithHits.add(candidate.row.sessionId);
    }
    if (hits.length === 0) return [];

    const abandonedBySession = new Map<string, Set<number>>();
    for (const sessionId of sessionsWithHits) {
      const abandonedEvents = IdbSessionStore.toEvents(
        this.eventsOf(sessionId).filter((row) => row.type === "turn/retried" || row.type === "turn/withdrawn"),
      );
      abandonedBySession.set(sessionId, collectAbandonedSeqs(abandonedEvents));
    }
    return hits.filter((hit) => !abandonedBySession.get(hit.sessionId)?.has(hit.seq));
  }

  private allMessageEvents(): EventRecord[] {
    const rows: EventRecord[] = [];
    for (const list of this.events.values()) {
      for (const row of list) {
        if (row.type === "user/message" || row.type === "assistant/message") rows.push(row);
      }
    }
    return rows;
  }

  migrateEvents(sessionId: string, events: ReadonlyArray<SessionEvent>, schemaVersion: number): void {
    if (events.some((event, index) => event.seq !== index)) {
      throw new Error(`Migration event batch contains a seq gap for session ${sessionId}`);
    }
    if (this.eventsOf(sessionId).length > 0) {
      throw new Error(`Session ${sessionId} already contains events`);
    }
    const now = Date.now();
    const records = events.map((event) => ({
      sessionId,
      seq: event.seq,
      type: event.type,
      data: JSON.stringify(event.data),
      time: event.time,
      schemaVersion,
    }));
    this.events.set(sessionId, records);
    for (const record of records) this.persist("events", record);
    const session = this.sessions.get(sessionId);
    if (session) {
      session.migratedAt = now;
      session.updatedAt = now;
      this.persist("sessions", session);
    }
  }

  isMigrated(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.migratedAt != null;
  }

  sessionNeedsMigration(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    return session.migratedAt == null && this.eventsOf(sessionId).length === 0 && (this.messages.get(sessionId)?.length ?? 0) > 0;
  }

  getSessionMessages(sessionId: string): AgentMessage[] {
    return this.getSessionMessagesWithIds(sessionId).map((r) => r.message);
  }

  private messagesOf(sessionId: string): MessageRecord[] {
    return this.messages.get(sessionId) ?? [];
  }

  private static toMessageEntry(row: MessageRecord): MessageWithId {
    return { id: row.id, message: parseAgentMessageContent(row.content, row.id, row.schemaVersion) };
  }

  getSessionMessagesWithIds(sessionId: string): MessageWithId[] {
    return this.messagesOf(sessionId).map(IdbSessionStore.toMessageEntry);
  }

  getMessagesAfter(sessionId: string, anchorId: number): MessageWithId[] {
    return this.messagesOf(sessionId)
      .filter((row) => row.id > anchorId)
      .map(IdbSessionStore.toMessageEntry);
  }

  getLatestCompaction(
    sessionId: string,
  ): {
    id: number;
    anchorMessageId: number;
    digestContent: string;
    tokenEstimate: number;
    createdAt: number;
  } | null {
    const rows = this.compactions.get(sessionId) ?? [];
    if (rows.length === 0) return null;
    const latest = [...rows].sort((a, b) => (b.createdAt - a.createdAt) || (b.id - a.id))[0];
    return {
      id: latest.id,
      anchorMessageId: latest.anchorMessageId,
      digestContent: latest.digestContent,
      tokenEstimate: latest.tokenEstimate,
      createdAt: latest.createdAt,
    };
  }

  getRecentMessages(
    sessionId: string,
    limit: number,
    beforeId?: number,
  ): {
    messages: AgentMessage[];
    entries: MessageWithId[];
    hasMore: boolean;
    oldestId: number | null;
  } {
    const effectiveLimit = Math.max(1, limit);
    const all = this.messagesOf(sessionId);
    let cursor: number;
    if (beforeId !== undefined) {
      cursor = beforeId;
    } else {
      if (all.length === 0) {
        return { messages: [], entries: [], hasMore: false, oldestId: null };
      }
      cursor = all[all.length - 1].id + 1;
    }
    const page = all.filter((row) => row.id < cursor).slice(-effectiveLimit).reverse();
    if (page.length === 0) {
      return { messages: [], entries: [], hasMore: false, oldestId: null };
    }
    const collected: MessageWithId[] = page.map((row) => IdbSessionStore.toMessageEntry(row));
    for (;;) {
      const oldest = collected[collected.length - 1];
      if (oldest.message.role !== "toolResult") break;
      const older = all.filter((row) => row.id < oldest.id).slice(-1)[0];
      if (!older) break;
      collected.push(IdbSessionStore.toMessageEntry(older));
    }
    const oldestId = collected[collected.length - 1].id;
    const hasMore = all.some((row) => row.id < oldestId);
    const entries = collected.reverse();
    return { messages: entries.map((entry) => entry.message), entries, hasMore, oldestId };
  }
}
