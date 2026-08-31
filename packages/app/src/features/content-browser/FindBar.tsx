import { type RefObject, useEffect, useRef } from "react";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { useI18n } from "@spherse/i18n/react";
import { useContentFind } from "./hooks/useContentFind";

interface FindBarProps {
  containerRef: RefObject<HTMLDivElement | null>;
  contentKey: string;
  onClose: () => void;
}

export function FindBar({ containerRef, contentKey, onClose }: FindBarProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const find = useContentFind({ containerRef, contentKey });

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const hasQuery = find.query.trim().length > 0;
  const hasMatch = find.matchCount > 0;
  const countLabel = !hasQuery
    ? ""
    : !hasMatch
      ? t("content-browser.find.noMatch")
      : find.overLimit
        ? `${find.matchIndex + 1}/${find.matchCount}+`
        : `${find.matchIndex + 1}/${find.matchCount}`;

  return (
    <div
      data-content-findbar
      className="flex items-center gap-2 border-b border-border bg-background px-3 py-2"
    >
      <Input
        ref={inputRef}
        value={find.query}
        placeholder={t("content-browser.find.placeholder")}
        onChange={(e) => find.setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) find.prev();
            else find.next();
          }
        }}
        className={hasQuery && !hasMatch ? "text-muted-foreground" : undefined}
        aria-label={t("content-browser.find.placeholder")}
      />
      <span className="min-w-[3rem] shrink-0 text-end font-mono text-xs text-muted-foreground tabular-nums">
        {countLabel}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={find.prev}
        disabled={!hasMatch}
        title={t("content-browser.find.previous")}
        aria-label={t("content-browser.find.previous")}
      >
        <ChevronUpIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={find.next}
        disabled={!hasMatch}
        title={t("content-browser.find.next")}
        aria-label={t("content-browser.find.next")}
      >
        <ChevronDownIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
        title={t("content-browser.find.close")}
        aria-label={t("content-browser.find.close")}
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}
