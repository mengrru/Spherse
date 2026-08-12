import { useState } from "react";
import { Check, Copy, Info } from "lucide-react";
import type { Platform } from "../lib/release";
import type { TranslationKey } from "../i18n";

const MAC_INSTALL_COMMAND = "xattr -cr /Applications/Spherse.app";

interface InstallTipProps {
  platform: Platform;
  t: (key: TranslationKey) => string;
}

export function InstallTip({ platform, t }: InstallTipProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(MAC_INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors — user can still read and type the command
    }
  };

  return (
    <div
      role="status"
      className="flex w-full max-w-2xl items-start gap-3 rounded-lg border border-border bg-card p-4 text-start shadow-sm"
    >
      <Info className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-col gap-2">
        {platform === "mac" ? (
          <>
            <p className="text-sm text-muted-foreground">{t("hero.macosTip")}</p>
            <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 font-mono text-sm">
              <code className="min-w-0 flex-1 break-all text-foreground">
                {MAC_INSTALL_COMMAND}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                aria-label={copied ? t("hero.copied") : t("hero.copyCommand")}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {copied ? (
                  <Check className="size-4 text-success" />
                ) : (
                  <Copy className="size-4" />
                )}
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("hero.windowsTip")}</p>
        )}
      </div>
    </div>
  );
}
