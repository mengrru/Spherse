import { useState } from "react";
import { LogOutIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { useHostBridge } from "../../context/host-bridge-context";
import { Button } from "../../components/ui/button";
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

export function WebDisconnectButton({
  variant,
  className,
}: {
  variant: "icon" | "panel";
  className?: string;
}) {
  const { t } = useI18n();
  const bridge = useHostBridge();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (bridge.kind !== "web") return null;

  const handleDisconnect = () => {
    void Promise.resolve(bridge.clearConnection?.())
      .catch(() => undefined)
      .then(() => {
        window.location.reload();
      });
  };

  return (
    <>
      {variant === "icon" ? (
        <Button
          variant="ghost"
          size="icon-lg"
          className={className}
          onClick={() => setConfirmOpen(true)}
          title={t("mobile-connect.disconnect")}
          aria-label={t("mobile-connect.disconnect")}
        >
          <LogOutIcon />
        </Button>
      ) : (
        <Button
          variant="ghost"
          className={`w-full justify-start gap-2 text-muted-foreground ${className ?? ""}`}
          onClick={() => setConfirmOpen(true)}
        >
          <LogOutIcon className="size-4" />
          {t("mobile-connect.disconnect")}
        </Button>
      )}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("mobile-connect.disconnectTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("mobile-connect.disconnectDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisconnect}>{t("mobile-connect.disconnect")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
