import { useEffect, useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { FieldGroup } from "../../components/ui/field";
import { MarkdownContent } from "../../components/MarkdownContent";
import { SectionTitle } from "./SectionTitle";
import { useUpdateChecker } from "./use-update-checker";

export function UpdateChecker() {
  const { t } = useI18n();
  const {
    state,
    check,
    acceptDownload,
    dismissUpdate,
    cancelDownload,
    acceptRestart,
    dismissRestart,
  } = useUpdateChecker();
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    void window.electronAPI.getAppVersion().then(setAppVersion);
  }, []);

  return (
    <FieldGroup>
      <SectionTitle>{t("settings.about.version")}</SectionTitle>
      <p className="text-sm text-muted-foreground">v{appVersion}</p>

      <div className="mt-1">
        {state.status === "idle" && (
          <Button onClick={() => void check()}>
            {t("settings.about.checkUpdate")}
          </Button>
        )}
        {state.status === "checking" && (
          <Button disabled>{t("settings.about.checking")}</Button>
        )}
        {state.status === "upToDate" && (
          <Button disabled variant="outline">
            {t("settings.about.upToDate")}
          </Button>
        )}
        {state.status === "error" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-destructive">
              {state.errorPhase === "download"
                ? t("settings.update.downloadError")
                : t("settings.about.checkFailed")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void check()}>
                {t("settings.about.retry")}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void window.electronAPI.openExternal(
                    "https://github.com/mengrru/Spherse/releases/"
                  )
                }
              >
                {t("settings.about.gotoReleases")}
              </Button>
            </div>
          </div>
        )}
        {state.status === "downloading" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {t("settings.update.downloading", {
                percent: state.percent ?? 0,
              })}
            </p>
            <div className="h-2 w-full rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-primary transition-all"
                style={{ width: `${state.percent ?? 0}%` }}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={cancelDownload}
            >
              {t("settings.update.cancel")}
            </Button>
          </div>
        )}
      </div>

      <Dialog
        open={state.status === "available"}
        onOpenChange={(open) => {
          if (!open) dismissUpdate();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("settings.update.newVersion", {
                version: state.version ?? "",
              })}
            </DialogTitle>
          </DialogHeader>
          {state.releaseNotes && (
            <div className="max-h-[40vh] overflow-y-auto">
              <p className="mb-2 text-sm font-medium">
                {t("settings.update.releaseNotes")}
              </p>
              <MarkdownContent variant="chat">{state.releaseNotes}</MarkdownContent>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={dismissUpdate}>
              {t("settings.update.later")}
            </Button>
            {state.downloadUrl ? (
              <Button
                onClick={() => {
                  void window.electronAPI.openExternal(state.downloadUrl!);
                  dismissUpdate();
                }}
              >
                {t("settings.update.gotoDownload")}
              </Button>
            ) : (
              <Button onClick={acceptDownload}>
                {t("settings.update.download")}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={state.status === "downloaded"}
        onOpenChange={(open) => {
          if (!open) dismissRestart();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.update.downloaded")}</DialogTitle>
            <DialogDescription>
              {t("settings.update.downloadedDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={dismissRestart}>
              {t("settings.update.restartLater")}
            </Button>
            <Button onClick={acceptRestart}>
              {t("settings.update.restartNow")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </FieldGroup>
  );
}
