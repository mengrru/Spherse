import { useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import { Button } from "../../components/ui/button";
import { CheckIcon, CopyIcon } from "lucide-react";

interface CopyButtonProps {
  text: string;
}

export function CopyButton({ text }: CopyButtonProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground"
      onClick={handleCopy}
      title={t("chat.copyTooltip")}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}
