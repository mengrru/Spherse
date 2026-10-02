import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useI18n } from "@spherse/i18n/react";
import { useHostBridge } from "../../context/host-bridge-context";
import { DOWNLOAD_PAGE_URL } from "../../lib/urls";

const UPDATE_TOAST_DURATION_MS = 10_000;

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
    const unsubscribe = updater.onUpdateEvent((event) => {
      if (event.type === "update-available") {
        if (!event.silent) return;
        if (event.inAppUpdate) {
          toast.success(
            tRef.current("settings.update.newVersion", { version: event.version }),
            {
              duration: UPDATE_TOAST_DURATION_MS,
              action: {
                label: tRef.current("settings.update.backgroundDownload"),
                onClick: () => void updater.downloadUpdate(),
              },
            },
          );
        } else {
          const downloadUrl = event.downloadUrl ?? DOWNLOAD_PAGE_URL;
          toast.success(
            tRef.current("settings.update.newVersion", { version: event.version }),
            {
              duration: UPDATE_TOAST_DURATION_MS,
              action: {
                label: tRef.current("settings.update.goUpdate"),
                onClick: () => void bridge.openExternal(downloadUrl),
              },
            },
          );
        }
        return;
      }
      if (event.type === "update-downloaded") {
        toast.success(tRef.current("settings.update.downloaded"), {
          duration: UPDATE_TOAST_DURATION_MS,
          action: {
            label: tRef.current("settings.update.installAndRestart"),
            onClick: () => void updater.installUpdate(),
          },
        });
        return;
      }
      if (event.type === "update-error" && event.phase === "download") {
        toast.error(tRef.current("settings.update.downloadError"), {
          duration: UPDATE_TOAST_DURATION_MS,
        });
      }
    });
    return unsubscribe;
  }, [bridge]);

  return null;
}
