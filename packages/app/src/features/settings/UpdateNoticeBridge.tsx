import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useI18n } from "@spherse/i18n/react";
import { useHostBridge } from "../../context/host-bridge-context";
import { DOWNLOAD_PAGE_URL } from "../../lib/urls";
import type { UpdateState } from "../../lib/host-bridge";

const UPDATE_TOAST_DURATION_MS = 10_000;
const AVAILABLE_TOAST_ID = "update-available";
const DOWNLOADED_TOAST_ID = "update-downloaded";
const ERROR_TOAST_ID = "update-error";

export function UpdateNoticeBridge() {
  const bridge = useHostBridge();
  const { t } = useI18n();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    const updater = bridge.updater;
    if (!updater) return;
    let active = true;
    let revision = 0;
    let current: UpdateState | undefined;
    let pending = false;

    async function run(phase: "download" | "install") {
      if (!active || pending) return;
      if (phase === "download" && current && current.status !== "available" &&
        !(current.status === "error" && current.errorPhase === "download")) return;
      if (phase === "install" && current?.status !== "downloaded") return;
      pending = true;
      const startedAt = ++revision;
      toast.dismiss(phase === "download" ? AVAILABLE_TOAST_ID : DOWNLOADED_TOAST_ID);
      try {
        await (phase === "download" ? updater!.downloadUpdate() : updater!.installUpdate());
      } catch {
        if (active && revision === startedAt) {
          if (phase === "install" && current) showState(current);
          toast.error(tRef.current(phase === "download" ? "settings.update.downloadError" : "settings.update.installError"), {
            id: ERROR_TOAST_ID,
          });
        }
      } finally {
        pending = false;
      }
    }

    function showState(state: UpdateState) {
      current = state;
      if (state.updateMode !== "inApp") return;
      if (state.status !== "available") toast.dismiss(AVAILABLE_TOAST_ID);
      if (state.status !== "downloaded") toast.dismiss(DOWNLOADED_TOAST_ID);
      if (state.status !== "error") toast.dismiss(ERROR_TOAST_ID);
      if (state.status === "downloaded") {
        toast.success(tRef.current("settings.update.downloadSuccess"), {
          id: DOWNLOADED_TOAST_ID,
          duration: Infinity,
          action: {
            label: tRef.current("settings.update.installAndRestart"),
            onClick: () => { void run("install"); },
          },
        });
      } else if (state.status === "error" && state.errorPhase !== "check") {
        toast.error(tRef.current(state.errorPhase === "install" ? "settings.update.installError" : "settings.update.downloadError"), {
          id: ERROR_TOAST_ID,
        });
      }
    }

    const unsubscribe = updater.onUpdateEvent((event) => {
      if (!active) return;
      revision++;
      if (event.type === "update-state") {
        showState(event.state);
        return;
      }
      if (event.type !== "update-available" || !event.silent) return;
      const inApp = event.updateMode === "inApp";
      if (inApp && current && current.status !== "available") return;
      const downloadUrl = event.downloadUrl ?? DOWNLOAD_PAGE_URL;
      toast.success(
        tRef.current("settings.update.newVersion", { version: event.version }),
        {
          id: AVAILABLE_TOAST_ID,
          duration: UPDATE_TOAST_DURATION_MS,
          action: {
            label: tRef.current(inApp ? "settings.update.backgroundDownload" : "settings.update.goUpdate"),
            onClick: () => {
              if (inApp) void run("download");
              else void bridge.openExternal(downloadUrl).catch(() => {
                if (active) toast.error(tRef.current("settings.update.downloadError"), { id: ERROR_TOAST_ID });
              });
            },
          },
        },
      );
    });
    const snapshotRevision = revision;
    void updater.getUpdateState().then((state) => {
      if (active && revision === snapshotRevision) showState(state);
    }).catch(() => {});
    return () => {
      active = false;
      unsubscribe();
      toast.dismiss(AVAILABLE_TOAST_ID);
      toast.dismiss(DOWNLOADED_TOAST_ID);
      toast.dismiss(ERROR_TOAST_ID);
    };
  }, [bridge]);

  return null;
}
