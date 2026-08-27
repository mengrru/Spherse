import { useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "../ui/button";
import { extractCodeText } from "./markdown-code-text";

interface CodeBlockProps extends React.HTMLAttributes<HTMLPreElement> {
  children?: React.ReactNode;
}

export function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const text = extractCodeText(children);

  const handleCopy = () => {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div className="group relative">
      <pre data-md-code className={className} {...props}>
        {children}
      </pre>
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute top-2 end-2 text-muted-foreground opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto"
        onClick={handleCopy}
        title={t("markdown.copyCode")}
        aria-label={t("markdown.copyCode")}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  );
}
