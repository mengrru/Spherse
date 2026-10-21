import type { ControlRequestKind, SessionControlEvent } from "./types.js";

export interface ControlRequest {
  requestId: string;
  kind: ControlRequestKind;
  toolCallId: string;
  toolName: string;
  args: unknown;
}

interface PendingRequest {
  requestId: string;
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

  swapEventSink(sink: ((e: SessionControlEvent) => void) | null): ((e: SessionControlEvent) => void) | null {
    const previous = this.eventSink;
    this.eventSink = sink;
    return previous;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  request<T>(req: ControlRequest, timeoutMs: number, timeoutDecision: T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(req.requestId)) {
          try {
            this.emitResolved(req.requestId, req.kind, timeoutDecision);
          } catch {
            // timeout decisions are fail-closed denials; a failed record must
            // not escalate into an uncaught exception inside the timer callback
          }
          (resolve as (d: unknown) => void)(timeoutDecision);
        }
      }, timeoutMs);
      this.pending.set(req.requestId, {
        requestId: req.requestId,
        kind: req.kind,
        resolve: resolve as (d: unknown) => void,
        reject,
        timer,
      });
      try {
        this.emit({
          type: "control_request",
          requestId: req.requestId,
          kind: req.kind,
          toolCallId: req.toolCallId,
          toolName: req.toolName,
          args: req.args,
        });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(req.requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  resolve(requestId: string, decision: unknown): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    try {
      this.emitResolved(requestId, entry.kind, decision);
    } catch (error) {
      clearTimeout(entry.timer);
      this.pending.delete(requestId);
      entry.reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve(decision);
  }

  rejectAll(reason: string): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
      try {
        this.emitAborted(entry.requestId, entry.kind);
      } catch {
        // one failed aborted-resolution record must not stop the remaining
        // cleanup nor the caller's abort chain
      }
    }
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

  private emitAborted(requestId: string, kind: ControlRequestKind): void {
    if (kind === "approval") {
      this.emit({
        type: "control_resolved",
        requestId,
        kind,
        approved: false,
        aborted: true,
      });
    } else {
      this.emit({
        type: "control_resolved",
        requestId,
        kind,
        timedOut: false,
        aborted: true,
      });
    }
  }
}
