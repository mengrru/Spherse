import { useCallback, useEffect, useReducer } from "react";
import type { UpdateState } from "@shared/electron-api";

export type Action =
  | { type: "CHECK" }
  | { type: "SET_STATE"; state: UpdateState }
  | { type: "UPDATE_AVAILABLE"; version: string; releaseNotes: string; downloadUrl?: string }
  | { type: "UP_TO_DATE" }
  | { type: "DOWNLOADING" }
  | { type: "PROGRESS"; percent: number }
  | { type: "DOWNLOADED" }
  | { type: "ERROR"; message: string }
  | { type: "RESET" };

export const initialState: UpdateState = { status: "idle" };

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
        errorPhase: state.status === "downloading" ? "download" : "check",
      };
    case "RESET":
      return { status: "idle" };
    default:
      return state;
  }
}

export function useUpdateChecker() {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    void (async () => {
      const current = await window.electronAPI.getUpdateState();
      dispatch({ type: "SET_STATE", state: current });
    })();

    const unsubscribe = window.electronAPI.onUpdateEvent((event) => {
      switch (event.type) {
        case "update-available":
          dispatch({
            type: "UPDATE_AVAILABLE",
            version: event.version,
            releaseNotes: event.releaseNotes,
            downloadUrl: event.downloadUrl,
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
          dispatch({ type: "ERROR", message: event.message });
          break;
        default:
          break;
      }
    });

    return unsubscribe;
  }, []);

  const check = useCallback(async () => {
    dispatch({ type: "CHECK" });
    await window.electronAPI.checkForUpdates({ silent: false });
  }, []);

  const acceptDownload = useCallback(() => {
    dispatch({ type: "DOWNLOADING" });
    void window.electronAPI.downloadUpdate();
  }, []);

  const dismissUpdate = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  const cancelDownload = useCallback(() => {
    void window.electronAPI.cancelUpdate();
    dispatch({ type: "RESET" });
  }, []);

  const acceptRestart = useCallback(() => {
    void window.electronAPI.installUpdate();
  }, []);

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
