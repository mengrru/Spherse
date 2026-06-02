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
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>确认删除</AlertDialogTitle>
        <AlertDialogDescription>
          {target &&
            (target.type === "directory"
              ? `确定要删除目录「${target.name}」吗？此操作不可撤销。`
              : `确定要删除文件「${target.name}」吗？此操作不可撤销。`)}
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
