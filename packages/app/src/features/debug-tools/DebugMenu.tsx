import { useState } from "react";
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
            <Button variant="ghost" size="icon-lg" title="Debug" />
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
            DevTools
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleReload}>
            <RefreshCwIcon />
            Reload
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleOpenStoreViewer}>
            <DatabaseIcon />
            App Data Viewer
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setResetDialogOpen(true)}
          >
            <TrashIcon />
            Reset App Data
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={storeViewerOpen} onOpenChange={setStoreViewerOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>App Data</DialogTitle>
          </DialogHeader>
          <pre className="overflow-auto rounded-md bg-muted p-4 font-mono text-xs max-h-[60vh]">
            {storeData}
          </pre>
        </DialogContent>
      </Dialog>

      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset App Data</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear all app settings, project list, and restart the
              application. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleReset}>
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
