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
import { useI18n } from "@spherse/i18n/react";

interface ConfirmDialogsProps {
  showLeaveConfirm: boolean;
  showCancelConfirm: boolean;
  onLeaveOpenChange: (open: boolean) => void;
  onCancelOpenChange: (open: boolean) => void;
  onConfirmLeave: () => void;
  onConfirmCancel: () => void;
}

export function ConfirmDialogs({
  showLeaveConfirm,
  showCancelConfirm,
  onLeaveOpenChange,
  onCancelOpenChange,
  onConfirmLeave,
  onConfirmCancel,
}: ConfirmDialogsProps) {
  const { t } = useI18n();
  return (
    <>
      <AlertDialog open={showLeaveConfirm} onOpenChange={onLeaveOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("content-browser.confirmLeaveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("content-browser.confirmLeaveMessage")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("content-browser.continueEditing")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onConfirmLeave}>
              {t("content-browser.discardChanges")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={showCancelConfirm} onOpenChange={onCancelOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("content-browser.confirmLeaveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("content-browser.confirmCancelMessage")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("content-browser.continueEditing")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onConfirmCancel}>
              {t("content-browser.discardChanges")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
