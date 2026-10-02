import { useCallback, useEffect, useReducer } from "react";
import type { UpdateState } from "../../lib/host-bridge";
import { useHostBridge } from "../../context/host-bridge-context";

export type Action =
  | { type: "CHECK" }
  | { type: "SET_STATE"; state: UpdateState }
  | { type: "UPDATE_AVAILABLE"; version: string; releaseNotes: string; downloadUrl?: string; inAppUpdate?: boolean }
  | { type: "UP_TO_DATE" }
  | { type: "DOWNLOADING" }
  | { type: "PROGRESS"; percent: number }
  | { type: "DOWNLOADED" }
  | { type: "ERROR"; message: string; phase?: "check" | "download" }
  | { type: "RESET" };

export const initialState: UpdateState = { status: "idle" };

export function restoreMountedState(state: UpdateState): UpdateState {
  return state.status === "available" ||
    state.status === "downloading" ||
    state.status === "downloaded"
    ? state
    : initialState;
}

export function reducer(state: UpdateState, action: Action): UpdateState {
  switch (action.type) {
    case "CHECK":
      return { status: "checking" };
    case "SET_STATE":
      return action.state;
    case "UPDATE_AVAILABLE":
      return {
        status: "available",
        version: action.version,
        releaseNotes: action.releaseNotes,
        downloadUrl: action.downloadUrl,
        inAppUpdate: action.inAppUpdate,
      };
    case "UP_TO_DATE":
      return { status: "upToDate" };
    case "DOWNLOADING":
      return { status: "downloading" };
    case "PROGRESS":
      return { status: "downloading", percent: action.percent };
    case "DOWNLOADED":
      return { status: "downloaded" };
    case "ERROR":
      return {
        status: "error",
        errorMessage: action.message,
        errorPhase: action.phase ?? (state.status === "downloading" ? "download" : "check"),
      };
    case "RESET":
      return { status: "idle" };
    default:
      return state;
  }
}

export function useUpdateChecker() {
  const bridge = useHostBridge();
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    const updater = bridge.updater;
    if (!updater) return;

    void (async () => {
      const current = await updater.getUpdateState();
      dispatch({ type: "SET_STATE", state: restoreMountedState(current) });
    })();

    const unsubscribe = updater.onUpdateEvent((event) => {
      switch (event.type) {
        case "update-available":
          if (event.silent) break;
          dispatch({
            type: "UPDATE_AVAILABLE",
            version: event.version,
            releaseNotes: event.releaseNotes,
            downloadUrl: event.downloadUrl,
            inAppUpdate: event.inAppUpdate,
          });
          break;
        case "update-not-available":
          dispatch({ type: "UP_TO_DATE" });
          break;
        case "download-progress":
          dispatch({ type: "PROGRESS", percent: event.percent });
          break;
        case "update-downloaded":
          dispatch({ type: "DOWNLOADED" });
          break;
        case "update-error":
          dispatch({ type: "ERROR", message: event.message, phase: event.phase });
          break;
        default:
          break;
      }
    });

    return unsubscribe;
  }, [bridge]);

  const check = useCallback(async () => {
    dispatch({ type: "CHECK" });
    await bridge.updater?.checkForUpdates({ silent: false });
  }, [bridge]);

  const acceptDownload = useCallback(() => {
    dispatch({ type: "DOWNLOADING" });
    void bridge.updater?.downloadUpdate();
  }, [bridge]);

  const dismissUpdate = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  const cancelDownload = useCallback(async () => {
    // 主进程取消后回到 available（保留版本信息），回填主进程状态而非本地 RESET，
    // 避免与 getUpdateState 不一致
    await bridge.updater?.cancelUpdate();
    const current = await bridge.updater?.getUpdateState();
    if (current) {
      dispatch({ type: "SET_STATE", state: restoreMountedState(current) });
    }
  }, [bridge]);

  const acceptRestart = useCallback(() => {
    void bridge.updater?.installUpdate();
  }, [bridge]);

  const dismissRestart = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  return {
    state,
    check,
    acceptDownload,
    dismissUpdate,
    cancelDownload,
    acceptRestart,
    dismissRestart,
  };
}
