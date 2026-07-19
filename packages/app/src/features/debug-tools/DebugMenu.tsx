import { useState } from "react";
import { useMatch } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { BugIcon, RefreshCwIcon, DatabaseIcon, TrashIcon, CodeIcon, ScrollTextIcon, DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { useAppStore } from "../../stores/app-store";
import { useHostBridge } from "../../context/host-bridge-context";
import { LogPanel } from "./LogPanel";

export function DebugMenu() {
  const bridge = useHostBridge();
  const [overlay, setOverlay] = useState<null | "store" | "reset" | "logs">(null);
  const [storeData, setStoreData] = useState<string>("");
  const [downloading, setDownloading] = useState(false);
  const { t } = useI18n();
  const chatMatch = useMatch("/project/:projectId/chat/:sessionId");

  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const projects = useAppStore((s) => s.projects);
  const activeProject = activeProjectId ? projects.get(activeProjectId) : null;

  const sessionId = chatMatch?.params.sessionId ?? null;

  const handleToggleDevTools = () => {
    void bridge.devTools?.toggleDevTools();
  };

  const handleOpenStoreViewer = async () => {
    const data = await bridge.devTools?.getElectronStoreData();
    if (!data) return;
    setStoreData(JSON.stringify(data, null, 2));
    setOverlay("store");
  };

  const handleReload = () => {
    void bridge.devTools?.reloadRenderer();
  };

  const handleReset = () => {
    void bridge.devTools?.resetAppData();
  };

  const handleDownloadTurnContext = async () => {
    if (!activeProject || !sessionId) {
      toast.error(t("debug.downloadTurnContextNoSession"));
      return;
    }
    setDownloading(true);
    try {
      const data = await activeProject.ctx.client.getTurnContext(sessionId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `turn-context-${sessionId.slice(0, 8)}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (_) {
      toast.error(t("debug.downloadTurnContextFailed"));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-lg" title={t("debug.debug")} />
          }
        >
          <BugIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right">
          <DropdownMenuItem onClick={handleToggleDevTools}>
            <CodeIcon />
            {t("debug.devTools")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleReload}>
            <RefreshCwIcon />
            {t("debug.reload")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleOpenStoreViewer}>
            <DatabaseIcon />
            {t("debug.appData")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setOverlay("logs")}
            disabled={!activeProject}
          >
            <ScrollTextIcon />
            Streaming Log
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleDownloadTurnContext}
            disabled={!sessionId || downloading}
          >
            <DownloadIcon />
            {t("debug.downloadTurnContext")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setOverlay("reset")}
          >
            <TrashIcon />
            {t("debug.resetAppData")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={overlay === "store"} onOpenChange={(open) => { if (!open) setOverlay(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{t("debug.appData")}</DialogTitle>
          </DialogHeader>
          <pre className="overflow-auto rounded-md bg-muted p-4 font-mono text-xs max-h-[60vh]">
            {storeData}
          </pre>
        </DialogContent>
      </Dialog>

      <AlertDialog open={overlay === "reset"} onOpenChange={(open) => { if (!open) setOverlay(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("debug.confirmResetTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("debug.confirmResetMessage")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("debug.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleReset}>
              {t("debug.reset")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {overlay === "logs" && activeProject && (
        <LogPanel onClose={() => setOverlay(null)} />
      )}
    </>
  );
}
