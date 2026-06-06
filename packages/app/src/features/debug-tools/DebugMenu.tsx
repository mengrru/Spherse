import { useState } from "react";
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
import { BugIcon, RefreshCwIcon, DatabaseIcon, TrashIcon, CodeIcon } from "lucide-react";

export function DebugMenu() {
  const [devToolsOpen, setDevToolsOpen] = useState(false);
  const [storeViewerOpen, setStoreViewerOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [storeData, setStoreData] = useState<string>("");
  const { t } = useI18n();

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
    </>
  );
}
