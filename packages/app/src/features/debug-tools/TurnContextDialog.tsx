import { useEffect, useMemo, useState } from "react";
import { DownloadIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { toast } from "sonner";
import type { DebugSessionEventContract } from "@spherse/contracts";
import type { ApiClient } from "../../lib/api";
import { ensureProjectSession } from "../../queries/project";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { EventLogRow } from "./EventLogRow";

interface TurnContextDialogProps {
  projectId: string;
  client: ApiClient | null;
  sessionId: string;
  onClose: () => void;
}

export function TurnContextDialog({ projectId, client, sessionId, onClose }: TurnContextDialogProps) {
  const { t } = useI18n();
  const [events, setEvents] = useState<DebugSessionEventContract[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [query, setQuery] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!client) {
      setLoading(false);
      setLoadFailed(true);
      return;
    }
    setLoading(true);
    setLoadFailed(false);
    ensureProjectSession(projectId, client, sessionId)
      .then(async (session) => {
        if (!session) throw new Error("session not found");
        const log = await client.getSessionEvents(session.agentId, sessionId);
        if (cancelled) return;
        setEvents(log.events);
      })
      .catch(() => {
        if (cancelled) return;
        setEvents(null);
        setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, projectId, sessionId, reloadToken]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!events) return [];
    if (!q) return events;
    return events.filter((event) => event.type.toLowerCase().includes(q));
  }, [events, query]);

  const handleDownload = async () => {
    if (!client) return;
    setDownloading(true);
    try {
      const data = await client.getTurnContext(sessionId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `turn-context-${sessionId.slice(0, 8)}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (_) {
      toast.error(t("debug.downloadTurnContextFailed"));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex h-[85vh] flex-col gap-3 sm:max-w-3xl">
        <DialogHeader className="flex-row items-center justify-between gap-2">
          <DialogTitle>{t("debug.turnContext")}</DialogTitle>
          <Button size="sm" onClick={handleDownload} disabled={downloading}>
            <DownloadIcon />
            {t("debug.downloadTurnContext")}
          </Button>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("debug.eventLogSearchPlaceholder")}
              className="ps-8"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setReloadToken((n) => n + 1)}
            title={t("debug.eventLogRefresh")}
            disabled={loading}
          >
            <RefreshCwIcon />
          </Button>
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {t("debug.eventLogCount", { count: filtered.length })}
          </span>
        </div>
        <div className="flex-1 overflow-auto rounded-md border border-border">
          {loading ? (
            <div className="p-4 text-xs text-muted-foreground">{t("common.loading")}</div>
          ) : loadFailed ? (
            <div className="flex flex-col items-center gap-2 p-4 text-xs text-muted-foreground">
              {t("debug.eventLogLoadFailed")}
              <Button variant="outline" size="sm" onClick={() => setReloadToken((n) => n + 1)}>
                {t("debug.eventLogRefresh")}
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground">{t("debug.eventLogEmpty")}</div>
          ) : (
            filtered.map((event) => <EventLogRow key={event.seq} event={event} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
