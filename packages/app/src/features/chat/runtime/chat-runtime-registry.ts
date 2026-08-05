import {
  ChatSessionRuntime,
  type ChatSessionRuntimeState,
} from "./chat-session-runtime";

export class ChatRuntimeRegistry<T extends ChatSessionRuntimeState> {
  private readonly runtimes = new Map<string, ChatSessionRuntime<T>>();

  get(sessionId: string): ChatSessionRuntime<T> | undefined {
    return this.runtimes.get(sessionId);
  }

  set(sessionId: string, runtime: ChatSessionRuntime<T>): void {
    this.runtimes.set(sessionId, runtime);
  }

  delete(sessionId: string): void {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) return;
    runtime.dispose();
    this.runtimes.delete(sessionId);
  }
}
