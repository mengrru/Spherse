import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { FileIcon, MessageSquareIcon, SearchIcon } from "lucide-react";
import type { SessionSearchHit } from "@spherse/contracts";
import { cn } from "../../lib/utils";
import { Dialog, DialogContent, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient } from "../../lib/use-connection";
import { sessionFallbackTitle } from "../../lib/session-title";
import { useProjectFileTree } from "../../queries/content";
import { useSessionSearch } from "../../queries/project";
import { useAppUiStore } from "../../stores/app-ui-store";
import { formatMessageTime } from "../chat/lib/format-time";

const CHAT_RESULTS_LIMIT = 20;
const FILE_RESULTS_LIMIT = 10;
const DEBOUNCE_MS = 300;

function fuzzyMatch(filePath: string, query: string): boolean {
  const lower = filePath.toLowerCase();
  const parts = query.toLowerCase().split(/\s+/).filter(Boolean);
  return parts.length === 0 || parts.every((seg) => lower.includes(seg));
}

export function GlobalSearchDialog() {
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);
  const navigate = useNavigate();
  const { t } = useI18n();
  const setOpen = useAppUiStore((state) => state.setGlobalSearchOpen);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(input.trim());
      setActiveIndex(0);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const chatQuery = useSessionSearch(projectId, client, query);
  const fileTreeQuery = useProjectFileTree(projectId, client);

  const chatHits = useMemo<SessionSearchHit[]>(
    () => (query ? chatQuery.data?.results.slice(0, CHAT_RESULTS_LIMIT) ?? [] : []),
    [query, chatQuery.data],
  );
  const fileHits = useMemo(() => {
    if (!query) return [];
    return (fileTreeQuery.data ?? [])
      .filter((filePath) => fuzzyMatch(filePath, query))
      .slice(0, FILE_RESULTS_LIMIT);
  }, [fileTreeQuery.data, query]);

  const chatLoading = Boolean(query) && chatQuery.isPending;
  const hasResults = chatHits.length > 0 || fileHits.length > 0;
  const stillLoading = chatLoading || (Boolean(query) && fileTreeQuery.isPending);
  const showSearchFailed = Boolean(query) && chatQuery.isError && !hasResults;
  const showSearching = Boolean(query) && stillLoading && !hasResults;
  const showNoResults = Boolean(query) && !stillLoading && !chatQuery.isError && !hasResults;

  const openChatHit = (hit: SessionSearchHit) => {
    setOpen(false);
    navigate(`/project/${projectId}/chat/${hit.sessionId}?messageId=${hit.seq}`);
  };

  const openFileHit = (filePath: string) => {
    setOpen(false);
    navigate(`/project/${projectId}/content?path=${encodeURIComponent(filePath)}`);
  };

  const total = chatHits.length + fileHits.length;

  useEffect(() => {
    if (activeIndex >= total) setActiveIndex(Math.max(0, total - 1));
  }, [activeIndex, total]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-search-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (total > 0) setActiveIndex((index) => (index + 1) % total);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (total > 0) setActiveIndex((index) => (index - 1 + total) % total);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.nativeEvent.isComposing) return;
      if (activeIndex < chatHits.length) {
        openChatHit(chatHits[activeIndex]);
      } else {
        const filePath = fileHits[activeIndex - chatHits.length];
        if (filePath !== undefined) openFileHit(filePath);
      }
    }
  };

  const renderItemClass = (active: boolean) =>
    cn(
      "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none select-none",
      active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
    );

  return (
    <Dialog open onOpenChange={(open) => { if (!open) setOpen(false); }}>
      <DialogContent
        showCloseButton={false}
        initialFocus={inputRef}
        className="top-[12%] translate-y-0 gap-0 p-0 sm:max-w-xl"
        data-global-search-dialog
      >
        <DialogTitle className="sr-only">{t("global-search.search")}</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={t("global-search.placeholder")}
            className="h-8 border-0 shadow-none focus-visible:ring-0 text-sm"
          />
        </div>
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-1.5">
          {!query && (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              {t("global-search.initialHint")}
            </div>
          )}
          {showSearching && (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              {t("global-search.searching")}
            </div>
          )}
          {showSearchFailed && (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              {t("global-search.searchFailed")}
            </div>
          )}
          {showNoResults && (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              {t("global-search.noResults")}
            </div>
          )}
          {chatHits.length > 0 && (
            <section>
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("global-search.chatResults")}
              </div>
              {chatHits.map((hit, index) => (
                <button
                  key={`${hit.sessionId}:${hit.seq}`}
                  type="button"
                  data-search-index={index}
                  className={renderItemClass(index === activeIndex)}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => openChatHit(hit)}
                >
                  <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {hit.sessionTitle ?? sessionFallbackTitle({ updatedAt: hit.time })}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {hit.snippet}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {formatMessageTime(hit.time)}
                  </span>
                </button>
              ))}
            </section>
          )}
          {fileHits.length > 0 && (
            <section>
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("global-search.fileResults")}
              </div>
              {fileHits.map((filePath, index) => {
                const flatIndex = chatHits.length + index;
                return (
                  <button
                    key={filePath}
                    type="button"
                    data-search-index={flatIndex}
                    className={renderItemClass(flatIndex === activeIndex)}
                    onMouseEnter={() => setActiveIndex(flatIndex)}
                    onClick={() => openFileHit(filePath)}
                  >
                    <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">
                        {filePath.split("/").pop() ?? filePath}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {filePath}
                      </span>
                    </span>
                  </button>
                );
              })}
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
