import { useEffect, useRef, useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import { CheckIcon, Undo2Icon, XIcon } from "lucide-react";
import { Button } from "../../components/ui/button";

const ARM_TIMEOUT_MS = 3000;

interface WithdrawButtonProps {
  onWithdraw: () => void;
}

export function WithdrawButton({ onWithdraw }: WithdrawButtonProps) {
  const { t } = useI18n();
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const arm = () => {
    setArmed(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setArmed(false), ARM_TIMEOUT_MS);
  };

  const disarm = () => {
    clearTimeout(timerRef.current);
    setArmed(false);
  };

  const confirm = () => {
    clearTimeout(timerRef.current);
    setArmed(false);
    onWithdraw();
  };

  if (!armed) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        onClick={arm}
        title={t("chat.withdrawTooltip")}
        data-chat-withdraw
      >
        <Undo2Icon />
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-destructive hover:text-destructive"
        onClick={confirm}
        title={t("chat.withdrawConfirmTooltip")}
        data-chat-withdraw-confirm
      >
        <CheckIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        onClick={disarm}
        title={t("chat.withdrawCancelTooltip")}
        data-chat-withdraw-cancel
      >
        <XIcon />
      </Button>
    </>
  );
}
