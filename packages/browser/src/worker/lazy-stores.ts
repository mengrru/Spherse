import {
  IdbMemoryStore,
  IdbSessionStore,
  type AgentMessage,
  type FsPort,
  type Logger,
  type MemoryEntry,
  type MemoryEntryPatch,
  type MemoryStorePort,
  type SessionStorePort,
  type SessionChangePayload,
  type SessionEvent,
} from "@spherse/core";

type SessionInfo = ReturnType<SessionStorePort["listSessions"]>[number];

type MessageSearchHit = ReturnType<SessionStorePort["searchMessages"]>[number];
type SessionMessageEntry = ReturnType<SessionStorePort["getSessionMessagesWithIds"]>[number];
type LatestCompaction = ReturnType<SessionStorePort["getLatestCompaction"]>;

export class LazySessionStore implements SessionStorePort {
  private store: IdbSessionStore | null = null;
  readonly ready: Promise<void>;

  constructor(
    storeKey: string,
    agentId: string,
    logger?: Logger,
    onSessionChange?: (payload: SessionChangePayload) => void,
  ) {
    this.ready = IdbSessionStore.open(storeKey, agentId, logger, onSessionChange).then((store) => {
      this.store = store;
    });
  }

  private inner(): SessionStorePort {
    if (!this.store) throw new Error("session store not ready");
    return this.store;
  }

  close(): void {
    this.store?.close();
  }

  createSession(title?: string, source?: string): string {
    return this.inner().createSession(title, source);
  }

  getSession(id: string): SessionInfo | null {
    return this.inner().getSession(id);
  }

  listSessions(): SessionInfo[] {
    return this.inner().listSessions();
  }

  listSessionsPage(limit: number, offset: number): { items: SessionInfo[]; hasMore: boolean } {
    return this.inner().listSessionsPage(limit, offset);
  }

  updateSessionTitle(sessionId: string, title: string): void {
    this.inner().updateSessionTitle(sessionId, title);
  }

  archiveSession(sessionId: string): void {
    this.inner().archiveSession(sessionId);
  }

  appendEvents(sessionId: string, events: ReadonlyArray<SessionEvent>, schemaVersion: number): void {
    this.inner().appendEvents(sessionId, events, schemaVersion);
  }

  readEvents(sessionId: string): SessionEvent[] {
    return this.inner().readEvents(sessionId);
  }

  readEventsAfter(sessionId: string, sinceSeq: number, limit: number): SessionEvent[] {
    return this.inner().readEventsAfter(sessionId, sinceSeq, limit);
  }

  readEventCount(sessionId: string): number {
    return this.inner().readEventCount(sessionId);
  }

  maxSeq(sessionId: string): number | null {
    return this.inner().maxSeq(sessionId);
  }

  searchMessages(query: string, prefetchLimit: number): MessageSearchHit[] {
    return this.inner().searchMessages(query, prefetchLimit);
  }

  migrateEvents(sessionId: string, events: ReadonlyArray<SessionEvent>, schemaVersion: number): void {
    this.inner().migrateEvents(sessionId, events, schemaVersion);
  }

  isMigrated(sessionId: string): boolean {
    return this.inner().isMigrated(sessionId);
  }

  sessionNeedsMigration(sessionId: string): boolean {
    return this.inner().sessionNeedsMigration(sessionId);
  }

  getSessionMessages(sessionId: string): AgentMessage[] {
    return this.inner().getSessionMessages(sessionId);
  }

  getSessionMessagesWithIds(sessionId: string): SessionMessageEntry[] {
    return this.inner().getSessionMessagesWithIds(sessionId);
  }

  getMessagesAfter(sessionId: string, anchorId: number): SessionMessageEntry[] {
    return this.inner().getMessagesAfter(sessionId, anchorId);
  }

  getLatestCompaction(sessionId: string): LatestCompaction {
    return this.inner().getLatestCompaction(sessionId);
  }

  getRecentMessages(
    sessionId: string,
    limit: number,
    beforeId?: number,
  ): {
    messages: AgentMessage[];
    entries: SessionMessageEntry[];
    hasMore: boolean;
    oldestId: number | null;
  } {
    return this.inner().getRecentMessages(sessionId, limit, beforeId);
  }
}

export class LazyMemoryStore implements MemoryStorePort {
  private store: IdbMemoryStore | null = null;
  readonly ready: Promise<void>;

  constructor(storeKey: string, fsPort: FsPort, logger?: Logger) {
    this.ready = IdbMemoryStore.open(storeKey, fsPort, undefined, logger).then((store) => {
      this.store = store;
    });
  }

  private inner(): MemoryStorePort {
    if (!this.store) throw new Error("memory store not ready");
    return this.store;
  }

  close(): void {
    this.store?.close();
  }

  async getCore(): Promise<string> {
    await this.ready;
    return this.inner().getCore();
  }

  async saveCore(content: string): Promise<void> {
    await this.ready;
    await this.inner().saveCore(content);
  }

  async appendCore(content: string): Promise<string> {
    await this.ready;
    return this.inner().appendCore(content);
  }

  count(): number {
    return this.inner().count();
  }

  list(limit?: number): MemoryEntry[] {
    return this.inner().list(limit);
  }

  save(content: string, tags?: string[]): MemoryEntry {
    return this.inner().save(content, tags);
  }

  update(id: string, patch: MemoryEntryPatch): MemoryEntry {
    return this.inner().update(id, patch);
  }

  deleteEntry(id: string): void {
    this.inner().deleteEntry(id);
  }

  search(query: string, limit?: number): MemoryEntry[] {
    return this.inner().search(query, limit);
  }
}
