import { useI18n } from "@spherse/i18n/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import type { TreeNode } from "./tree-model";

export function DeleteConfirmDialog({
  target,
  onConfirm,
  onCancel,
}: {
  target: TreeNode | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>{t("file-tree.confirmDeleteTitle")}</AlertDialogTitle>
        <AlertDialogDescription>
          {target &&
            (target.type === "directory"
              ? t("file-tree.confirmDeleteDir", { name: target.name })
              : t("file-tree.confirmDeleteFile", { name: target.name }))}
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
