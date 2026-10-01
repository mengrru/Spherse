interface ShutdownActions {
  cleanup(): Promise<void>;
  quit(): void;
  relaunch(): void;
  exit(code: number): void;
}

export function createShutdownCoordinator(actions: ShutdownActions) {
  let owner: "quit" | "install" | null = null;
  let allowExit = false;
  let task: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let installFailure: ((error: unknown) => void) | undefined;
  let recovering = false;

  function failInstall(error: unknown): void {
    if (owner !== "install" || recovering) return;
    recovering = true;
    installFailure?.(error);
    clearTimeout(timer);
    timer = setTimeout(() => actions.exit(1), 5_000);
    timer.unref();
    allowExit = true;
    try {
      actions.relaunch();
    } catch (err) {
      console.error("[main] failed to relaunch after update failure:", err);
    }
    actions.quit();
  }

  function start(handoff?: () => void): Promise<void> {
    timer = setTimeout(() => {
      const error = new Error("Graceful shutdown timed out");
      if (owner === "install") failInstall(error);
      else actions.exit(1);
    }, 30_000);
    timer.unref();
    return Promise.resolve().then(async () => {
      try {
        await actions.cleanup();
        if (recovering) return;
        allowExit = true;
        if (handoff) handoff();
        else actions.quit();
      } catch (error) {
        if (owner === "install") failInstall(error);
        else {
          console.error("[main] graceful shutdown failed:", error);
          allowExit = true;
          actions.quit();
        }
      }
    });
  }

  return {
    isQuitting: () => owner !== null,
    canExit: () => allowExit,
    quit(): Promise<void> {
      if (owner) return task ?? Promise.resolve();
      owner = "quit";
      task = start();
      return task;
    },
    async install(handoff: () => void, onFailure: (error: unknown) => void): Promise<boolean> {
      if (owner) return false;
      owner = "install";
      installFailure = onFailure;
      task = start(handoff);
      await task;
      return true;
    },
    failInstall,
  };
}

export type ShutdownCoordinator = ReturnType<typeof createShutdownCoordinator>;
export let shutdown: ShutdownCoordinator | undefined;

export function configureShutdown(actions: ShutdownActions): ShutdownCoordinator {
  shutdown = createShutdownCoordinator(actions);
  return shutdown;
}

export function isQuitting(): boolean {
  return shutdown?.isQuitting() ?? false;
}
