import { ChatSessionRuntime } from "./chat-session-runtime";

export class ChatRuntimeRegistry {
  private readonly runtimes = new Map<string, ChatSessionRuntime>();

  get(sessionId: string): ChatSessionRuntime | undefined {
    return this.runtimes.get(sessionId);
  }

  set(sessionId: string, runtime: ChatSessionRuntime): void {
    this.runtimes.set(sessionId, runtime);
  }

  delete(sessionId: string): void {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) return;
    runtime.dispose();
    this.runtimes.delete(sessionId);
  }
}
