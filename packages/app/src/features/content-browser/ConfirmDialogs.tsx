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
  return (
    <>
      <AlertDialog open={showLeaveConfirm} onOpenChange={onLeaveOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>有未保存的修改</AlertDialogTitle>
            <AlertDialogDescription>确定离开当前文件并放弃这些修改吗？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onConfirmLeave}>
              放弃修改
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={showCancelConfirm} onOpenChange={onCancelOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>有未保存的修改</AlertDialogTitle>
            <AlertDialogDescription>确定取消编辑并放弃这些修改吗？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onConfirmCancel}>
              放弃修改
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
