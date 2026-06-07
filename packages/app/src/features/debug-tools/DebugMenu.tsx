import { useState } from "react";
import { useLocation } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
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
import { LogPanel } from "./LogPanel";
import { createApiClient } from "../../lib/api";

function extractSessionId(pathname: string): string | null {
  const match = pathname.match(/\/project\/[^/]+\/chat\/([a-f0-9-]+)/);
  return match?.[1] ?? null;
}

export function DebugMenu() {
  const [devToolsOpen, setDevToolsOpen] = useState(false);
  const [storeViewerOpen, setStoreViewerOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [logPanelOpen, setLogPanelOpen] = useState(false);
  const [storeData, setStoreData] = useState<string>("");
  const [downloading, setDownloading] = useState(false);
  const { t } = useI18n();
  const location = useLocation();

  const activeProjectKey = useAppStore((s) => s.activeProjectKey);
  const projects = useAppStore((s) => s.projects);
  const activeProject = activeProjectKey ? projects.get(activeProjectKey) : null;
  const port = activeProject?.port;

  const sessionId = port ? extractSessionId(location.pathname) : null;

  const handleDevToolsToggle = async (checked: boolean) => {
    await window.electronAPI.toggleDevTools();
    setDevToolsOpen(checked);
  };

  const handleOpenStoreViewer = async () => {
    const data = await window.electronAPI.getElectronStoreData();
    setStoreData(JSON.stringify(data, null, 2));
    setStoreViewerOpen(true);
  };

  const handleReload = () => {
    window.electronAPI.reloadRenderer();
  };

  const handleReset = () => {
    window.electronAPI.resetAppData();
  };

  const handleDownloadTurnContext = async () => {
    if (!port || !sessionId) {
      toast.error(t("debug.downloadTurnContextNoSession"));
      return;
    }
    setDownloading(true);
    try {
      const client = createApiClient(port);
      const data = await client.getTurnContext(sessionId);
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
          <DropdownMenuCheckboxItem
            checked={devToolsOpen}
            onCheckedChange={handleDevToolsToggle}
          >
            <CodeIcon />
            {t("debug.devTools")}
          </DropdownMenuCheckboxItem>
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
            onClick={() => setLogPanelOpen(true)}
            disabled={!port}
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
            onClick={() => setResetDialogOpen(true)}
          >
            <TrashIcon />
            {t("debug.resetAppData")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={storeViewerOpen} onOpenChange={setStoreViewerOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{t("debug.appData")}</DialogTitle>
          </DialogHeader>
          <pre className="overflow-auto rounded-md bg-muted p-4 font-mono text-xs max-h-[60vh]">
            {storeData}
          </pre>
        </DialogContent>
      </Dialog>

      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
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

      {logPanelOpen && port && (
        <LogPanel port={port} onClose={() => setLogPanelOpen(false)} />
      )}
    </>
  );
}
