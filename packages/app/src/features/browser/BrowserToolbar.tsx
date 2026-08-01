import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useI18n } from "@spherse/i18n/react";
import { toast } from "sonner";
import { ExternalLinkIcon, PictureInPicture2Icon, RefreshCwIcon, ExpandIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { isLoopbackUrl } from "./open-external-url";

interface BrowserToolbarProps {
  url: string;
  mode: "float" | "page";
  onNavigate: (url: string) => void;
  onRefresh: () => void;
  onOpenInSystem: () => void;
  onToggleMode: () => void;
  leading?: ReactNode;
}

export function BrowserToolbar({
  url,
  mode,
  onNavigate,
  onRefresh,
  onOpenInSystem,
  onToggleMode,
  leading,
}: BrowserToolbarProps) {
  const { t } = useI18n();
  const [value, setValue] = useState(url);

  useEffect(() => {
    setValue(url);
  }, [url]);

  const commit = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setValue(url);
      return;
    }
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    if (isLoopbackUrl(normalized)) {
      onNavigate(normalized);
    } else {
      toast.error(t("browser.localOnly"));
      setValue(url);
    }
  };

  return (
    <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-2 py-1.5">
      {leading}
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        onClick={onRefresh}
        title={t("browser.refresh")}
        aria-label={t("browser.refresh")}
      >
        <RefreshCwIcon />
      </Button>
      <Input
        className="h-7 flex-1 font-mono text-xs"
        value={value}
        placeholder={t("browser.addressPlaceholder")}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        onClick={onOpenInSystem}
        title={t("browser.openInSystemBrowser")}
        aria-label={t("browser.openInSystemBrowser")}
      >
        <ExternalLinkIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        onClick={onToggleMode}
        title={mode === "float" ? t("browser.expandToPage") : t("browser.collapseToFloat")}
        aria-label={mode === "float" ? t("browser.expandToPage") : t("browser.collapseToFloat")}
      >
        {mode === "float" ? <ExpandIcon /> : <PictureInPicture2Icon />}
      </Button>
    </div>
  );
}
