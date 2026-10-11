import { useEffect, useMemo, useState } from "react";
import { ArrowLeftIcon, CheckIcon, CopyIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { useGlobalApiClient } from "../../lib/use-connection";
import { ApiError } from "../../lib/api";
import { deriveCategories, filterByCategory } from "../../lib/categories";
import {
  invalidateMarketplacePromptQueries,
  promptLanguageFromLocale,
  useMarketplacePrompts,
} from "../../queries/marketplace-prompts";

function PromptCopyButton({ content }: { content: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = () => {
    navigator.clipboard
      .writeText(content)
      .then(() => setCopied(true))
      .catch(() => {});
  };

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleCopy} data-prompt-copy>
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? t("agent-dialog.templates.copied") : t("agent-dialog.templates.copy")}
    </Button>
  );
}

export function PromptTemplatesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const client = useGlobalApiClient();
  const language = promptLanguageFromLocale(locale);
  const promptsQuery = useMarketplacePrompts(client, language, open);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedId(null);
      setSelectedCategory(null);
      void invalidateMarketplacePromptQueries(language);
    }
  }, [open, language]);

  const entries = useMemo(() => promptsQuery.data?.prompts ?? [], [promptsQuery.data]);
  const categories = useMemo(() => deriveCategories(entries), [entries]);
  const visible = useMemo(() => filterByCategory(entries, selectedCategory), [entries, selectedCategory]);
  const selected = useMemo(
    () => entries.find((entry) => entry.id === selectedId) ?? null,
    [entries, selectedId],
  );

  const isMissingMarketplace =
    promptsQuery.isError &&
    promptsQuery.error instanceof ApiError &&
    promptsQuery.error.status === 404;

  const renderBody = () => {
    if (promptsQuery.isPending) {
      return <p className="py-10 text-center text-muted-foreground">{t("agent-dialog.templates.loading")}</p>;
    }
    if (promptsQuery.isError) {
      if (isMissingMarketplace) {
        return <p className="py-10 text-center text-muted-foreground">{t("agent-dialog.templates.empty")}</p>;
      }
      return (
        <div className="flex flex-col items-center gap-3 py-10">
          <p className="text-muted-foreground">{t("agent-dialog.templates.loadFailed")}</p>
          <Button variant="outline" size="sm" onClick={() => promptsQuery.refetch()}>
            {t("agent-dialog.templates.retry")}
          </Button>
        </div>
      );
    }
    if (selected) {
      return (
        <div className="flex min-h-0 flex-col gap-3" data-prompt-detail={selected.id}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedId(null)}
                data-prompt-back
              >
                <ArrowLeftIcon />
                {t("agent-dialog.templates.back")}
              </Button>
              <span className="truncate text-sm font-medium">{selected.title}</span>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[0.625rem] text-muted-foreground">
                {selected.category}
              </span>
            </div>
            <PromptCopyButton content={selected.content} />
          </div>
          <pre className="max-h-[50vh] flex-1 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
            {selected.content}
          </pre>
        </div>
      );
    }
    if (visible.length === 0) {
      return <p className="py-10 text-center text-muted-foreground">{t("agent-dialog.templates.empty")}</p>;
    }
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {visible.map((entry) => (
          <div
            key={entry.id}
            className="flex flex-col gap-2 rounded-lg border border-border p-3"
            data-prompt-card={entry.id}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs font-medium">{entry.title}</span>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[0.625rem] text-muted-foreground">
                {entry.category}
              </span>
            </div>
            <p className="line-clamp-2 flex-1 text-muted-foreground">{entry.description}</p>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedId(entry.id)}
                data-prompt-view
              >
                {t("agent-dialog.templates.view")}
              </Button>
              <PromptCopyButton content={entry.content} />
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("agent-dialog.templates.title")}</DialogTitle>
        </DialogHeader>
        {!selected && entries.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1" data-prompt-categories>
            <button
              type="button"
              onClick={() => setSelectedCategory(null)}
              className={
                selectedCategory === null
                  ? "shrink-0 rounded-full border border-primary bg-primary px-2.5 py-0.5 text-xs text-primary-foreground"
                  : "shrink-0 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
              }
            >
              {t("agent-dialog.templates.categoryAll")}
            </button>
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setSelectedCategory(category)}
                className={
                  selectedCategory === category
                    ? "shrink-0 rounded-full border border-primary bg-primary px-2.5 py-0.5 text-xs text-primary-foreground"
                    : "shrink-0 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
                }
              >
                {category}
              </button>
            ))}
          </div>
        )}
        <div className="max-h-[60vh] overflow-y-auto">{renderBody()}</div>
      </DialogContent>
    </Dialog>
  );
}
