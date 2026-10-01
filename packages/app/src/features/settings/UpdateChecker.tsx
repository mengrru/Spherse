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
import { MarkdownContent } from "../../components/markdown-content/MarkdownContent";
import { SectionTitle } from "./SectionTitle";
import { useUpdateChecker } from "./use-update-checker";
import { useHostBridge } from "../../context/host-bridge-context";
import { DOWNLOAD_PAGE_URL } from "../../lib/urls";

export function UpdateChecker() {
  const bridge = useHostBridge();
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
  const inApp = state.updateMode === "inApp";

  useEffect(() => {
    let active = true;
    void bridge.updater?.getAppVersion().then((version) => {
      if (active) setAppVersion(version);
    }).catch(() => {});
    return () => { active = false; };
  }, [bridge]);

  return (
    <FieldGroup>
      <SectionTitle>{t("settings.about.version")}</SectionTitle>
      <p className="text-sm text-muted-foreground">v{appVersion}</p>

      <div className="mt-1">
        {inApp && state.errorMessage && (state.status === "downloaded" || state.status === "downloading") && (
          <p role="alert" className="mb-2 text-sm text-destructive">
            {t(state.errorPhase === "install" ? "settings.update.installError" : "settings.update.downloadError")}
          </p>
        )}
        {inApp && state.status === "available" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm">{t("settings.update.newVersion", { version: state.version ?? "" })}</p>
            {state.releaseNotes && <MarkdownContent variant="chat">{state.releaseNotes}</MarkdownContent>}
            <Button className="w-fit" onClick={acceptDownload}>
              {t("settings.update.backgroundDownload")}
            </Button>
          </div>
        )}
        {inApp && state.status === "downloaded" && (
          <Button onClick={acceptRestart}>{t("settings.update.installAndRestart")}</Button>
        )}
        {state.status === "installing" && (
          <Button disabled>{t("settings.update.installing")}</Button>
        )}
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
                : state.errorPhase === "install"
                  ? t("settings.update.installError")
                  : t("settings.about.checkFailed")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={inApp && state.errorPhase === "download" ? acceptDownload : check}>
                {t("settings.about.retry")}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void bridge.openExternal(DOWNLOAD_PAGE_URL)
                }
              >
                {t("settings.about.gotoDownloadPage")}
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
            <div
              role="progressbar"
              aria-label={t("settings.update.downloading", { percent: state.percent ?? 0 })}
              aria-valuenow={state.percent ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2 w-full rounded-full bg-muted"
            >
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
        open={!inApp && state.status === "available"}
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
              <MarkdownContent variant="chat" onLinkClick={(href, event) => {
                event.preventDefault();
                void bridge.openExternal(href).catch(() => {});
              }}>{state.releaseNotes}</MarkdownContent>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={dismissUpdate}>
              {t("settings.update.later")}
            </Button>
            <Button
              onClick={() => {
                void bridge.openExternal(state.downloadUrl ?? DOWNLOAD_PAGE_URL);
                dismissUpdate();
              }}
            >
              {t("settings.update.gotoDownload")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!inApp && state.status === "downloaded"}
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
