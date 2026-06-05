import { useState } from "react";
import { Button } from "../../components/ui/button";
import { CheckIcon, CopyIcon } from "lucide-react";

interface CopyButtonProps {
  text: string;
}

export function CopyButton({ text }: CopyButtonProps) {
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
      title="复制"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}
