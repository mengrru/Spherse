import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import webpush from "web-push";

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: PushSubscriptionKeys;
  locale: string;
  createdAt: number;
}

interface PushStorageData {
  vapid: { publicKey: string; privateKey: string };
  subscriptions: PushSubscriptionRecord[];
}

const EMPTY_DATA: PushStorageData = { vapid: { publicKey: "", privateKey: "" }, subscriptions: [] };

export class PushStore {
  private data: PushStorageData | undefined;
  private persistChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly onError?: (err: unknown) => void,
  ) {}

  getVapid(): { publicKey: string; privateKey: string } {
    const data = this.ensureLoaded();
    if (!data.vapid.publicKey || !data.vapid.privateKey) {
      data.vapid = webpush.generateVAPIDKeys();
      void this.persist();
    }
    return data.vapid;
  }

  list(): PushSubscriptionRecord[] {
    return this.ensureLoaded().subscriptions;
  }

  upsert(record: Omit<PushSubscriptionRecord, "createdAt">): PushSubscriptionRecord {
    const data = this.ensureLoaded();
    const existing = data.subscriptions.find((sub) => sub.endpoint === record.endpoint);
    if (existing) {
      existing.keys = record.keys;
      existing.locale = record.locale;
      void this.persist();
      return existing;
    }
    const created: PushSubscriptionRecord = { ...record, createdAt: Date.now() };
    data.subscriptions.push(created);
    void this.persist();
    return created;
  }

  remove(endpoint: string): void {
    const data = this.ensureLoaded();
    const next = data.subscriptions.filter((sub) => sub.endpoint !== endpoint);
    if (next.length === data.subscriptions.length) return;
    data.subscriptions = next;
    void this.persist();
  }

  flush(): Promise<void> {
    return this.persistChain;
  }

  private ensureLoaded(): PushStorageData {
    if (this.data) return this.data;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf-8"));
    } catch {
      parsed = undefined;
    }
    if (!isPushStorageData(parsed)) {
      this.data = { vapid: { ...EMPTY_DATA.vapid }, subscriptions: [] };
    } else {
      this.data = parsed;
    }
    return this.data;
  }

  private persist(): Promise<void> {
    this.persistChain = this.persistChain.then(
      () => this.writeNow(),
      () => this.writeNow(),
    );
    this.persistChain = this.persistChain.catch((err) => {
      this.onError?.(err);
    });
    return this.persistChain;
  }

  private async writeNow(): Promise<void> {
    if (!this.data) return;
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await rename(tmp, this.filePath);
  }
}

function isPushStorageData(value: unknown): value is PushStorageData {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PushStorageData>;
  if (
    typeof candidate.vapid !== "object" ||
    candidate.vapid === null ||
    typeof candidate.vapid.publicKey !== "string" ||
    typeof candidate.vapid.privateKey !== "string"
  ) {
    return false;
  }
  return Array.isArray(candidate.subscriptions);
}
