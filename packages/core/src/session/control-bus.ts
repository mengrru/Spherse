import type { ControlRequestKind, SessionControlEvent } from "./types.js";

export interface ControlRequest {
  requestId: string;
  kind: ControlRequestKind;
  toolCallId: string;
  toolName: string;
  args: unknown;
}

interface PendingRequest {
  kind: ControlRequestKind;
  resolve: (decision: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class SessionControlBus {
  private readonly pending = new Map<string, PendingRequest>();
  private eventSink: ((e: SessionControlEvent) => void) | null = null;

  setEventSink(sink: ((e: SessionControlEvent) => void) | null): void {
    this.eventSink = sink;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  request<T>(req: ControlRequest, timeoutMs: number, timeoutDecision: T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(req.requestId)) {
          (resolve as (d: unknown) => void)(timeoutDecision);
          this.emitResolved(req.requestId, req.kind, timeoutDecision);
        }
      }, timeoutMs);
      this.pending.set(req.requestId, {
        kind: req.kind,
        resolve: resolve as (d: unknown) => void,
        reject,
        timer,
      });
      this.emit({
        type: "control_request",
        requestId: req.requestId,
        kind: req.kind,
        toolCallId: req.toolCallId,
        toolName: req.toolName,
        args: req.args,
      });
    });
  }

  resolve(requestId: string, decision: unknown): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve(decision);
    this.emitResolved(requestId, entry.kind, decision);
  }

  rejectAll(reason: string): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private emit(e: SessionControlEvent): void {
    this.eventSink?.(e);
  }

  private emitResolved(requestId: string, kind: ControlRequestKind, decision: unknown): void {
    if (kind === "approval") {
      const d = decision as { approved: boolean; reason?: string };
      this.emit({
        type: "control_resolved",
        requestId,
        kind,
        approved: d.approved,
        reason: d.reason,
      });
    }
    if (kind === "question") {
      const d = decision as { answer?: string; timedOut: boolean };
      this.emit({
        type: "control_resolved",
        requestId,
        kind,
        answer: d.answer,
        timedOut: d.timedOut,
      });
    }
  }
}
