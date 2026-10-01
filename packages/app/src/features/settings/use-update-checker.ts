import { useEffect, useReducer, useRef } from "react";
import type { UpdateState } from "../../lib/host-bridge";
import { useHostBridge } from "../../context/host-bridge-context";

export type Action =
  | { type: "CHECK" }
  | { type: "SET_STATE"; state: UpdateState }
  | { type: "UPDATE_AVAILABLE"; version: string; releaseNotes: string; downloadUrl?: string; updateMode?: UpdateState["updateMode"] }
  | { type: "UP_TO_DATE" }
  | { type: "DOWNLOADING" }
  | { type: "PROGRESS"; percent: number }
  | { type: "DOWNLOADED" }
  | { type: "ERROR"; message: string; phase?: UpdateState["errorPhase"] }
  | { type: "RESET" };

export const initialState: UpdateState = { status: "idle" };

export function restoreMountedState(state: UpdateState): UpdateState {
  if (state.status === "upToDate") return { status: "idle", updateMode: state.updateMode };
  return state.updateMode === "inApp" || state.status === "available" ||
    state.status === "downloading" ||
    state.status === "downloaded"
    ? state
    : initialState;
}

export function reducer(state: UpdateState, action: Action): UpdateState {
  switch (action.type) {
    case "CHECK":
      return { updateMode: state.updateMode, status: "checking" };
    case "SET_STATE":
      return action.state;
    case "UPDATE_AVAILABLE":
      return {
        status: "available",
        version: action.version,
        releaseNotes: action.releaseNotes,
        downloadUrl: action.downloadUrl,
        updateMode: action.updateMode,
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
        ...(state.updateMode === "inApp" ? state : {}),
        status: state.updateMode === "inApp" && action.phase &&
          (state.status === "downloaded" || state.status === "downloading")
          ? state.status : "error",
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
  const lifecycle = useRef({ active: false, revision: 0 });

  useEffect(() => {
    const updater = bridge.updater;
    if (!updater) return;

    const scope = { active: true, revision: 0 };
    lifecycle.current = scope;
    const unsubscribe = updater.onUpdateEvent((event) => {
      if (!scope.active) return;
      scope.revision++;
      switch (event.type) {
        case "update-state":
          dispatch({ type: "SET_STATE", state: event.state });
          break;
        case "update-available":
          if (event.updateMode === "inApp" || event.silent) break;
          dispatch({
            type: "UPDATE_AVAILABLE",
            version: event.version,
            releaseNotes: event.releaseNotes,
            downloadUrl: event.downloadUrl,
            updateMode: event.updateMode,
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

    const revision = scope.revision;
    void updater.getUpdateState().then((current) => {
      if (scope.active && scope.revision === revision) {
        dispatch({ type: "SET_STATE", state: restoreMountedState(current) });
      }
    }).catch((error: unknown) => {
      if (scope.active && scope.revision === revision) {
        dispatch({ type: "ERROR", message: String(error), phase: "check" });
      }
    });

    return () => {
      scope.active = false;
      unsubscribe();
    };
  }, [bridge]);

  async function run(phase: NonNullable<UpdateState["errorPhase"]>, command: () => Promise<void>, optimistic?: Action) {
    const scope = lifecycle.current;
    if (!scope.active) return;
    const revision = ++scope.revision;
    if (optimistic) dispatch(optimistic);
    try {
      await command();
      if (optimistic?.type === "CHECK" && scope.active && scope.revision === revision) {
        const current = await bridge.updater!.getUpdateState();
        if (scope.active && scope.revision === revision) {
          dispatch({ type: "SET_STATE", state: current });
        }
      }
    } catch (error) {
      if (scope.active && scope.revision === revision) {
        dispatch({ type: "ERROR", message: String(error), phase });
      }
    }
  }

  async function check() {
    if (!bridge.updater) return;
    await run("check", () => bridge.updater!.checkForUpdates({ silent: false }), { type: "CHECK" });
  }

  async function acceptDownload() {
    if (!bridge.updater) return;
    await run("download", () => bridge.updater!.downloadUpdate(),
      state.updateMode === "inApp" ? undefined : { type: "DOWNLOADING" });
  }

  function dismissUpdate() {
    if (state.updateMode !== "inApp") dispatch({ type: "RESET" });
  }

  async function cancelDownload() {
    if (!bridge.updater) return;
    await run("download", () => bridge.updater!.cancelUpdate(),
      state.updateMode === "inApp" ? undefined : { type: "RESET" });
  }

  async function acceptRestart() {
    if (!bridge.updater) return;
    await run("install", () => bridge.updater!.installUpdate());
  }

  return {
    state,
    check,
    acceptDownload,
    dismissUpdate,
    cancelDownload,
    acceptRestart,
    dismissRestart: dismissUpdate,
  };
}
