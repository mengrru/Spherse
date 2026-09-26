import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@spherse/i18n/react";
import { PencilIcon, SearchIcon, Trash2Icon } from "lucide-react";
import type { AgentMemoryConfig, AgentMemoryEntry } from "../../lib/types";
import { useApiClient } from "../../lib/use-connection";
import { useProjectAgents } from "../../queries/project";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Switch } from "../../components/ui/switch";
import { Badge } from "../../components/ui/badge";

interface MemoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  projectId: string;
}

interface EntryDraft {
  content: string;
  tags: string;
}

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function formatTime(ms: number, locale: string): string {
  return new Date(ms).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

export function MemoryDialog({ open, onOpenChange, agentId, projectId }: MemoryDialogProps) {
  const { t, locale } = useI18n();
  const client = useApiClient(projectId);
  const { agents } = useProjectAgents(projectId, client);
  const agentName = agents.find((agent) => agent.id === agentId)?.name ?? "";

  const [enabled, setEnabled] = useState(false);
  const [core, setCore] = useState("");
  const [coreLimit, setCoreLimit] = useState(4000);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [entries, setEntries] = useState<AgentMemoryEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [entryDraft, setEntryDraft] = useState<EntryDraft>({ content: "", tags: "" });
  const [deleteTarget, setDeleteTarget] = useState<AgentMemoryEntry | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setEditingId(null);
    setDeleteTarget(null);
    setSearch("");
    client
      .getAgentMemory(agentId)
      .then((config: AgentMemoryConfig) => {
        setEnabled(config.enabled);
        setCore(config.core);
        setCoreLimit(config.coreLimit);
      })
      .catch((err: unknown) =>
        toast.error(t("agent-memory.loadFailed", { message: (err as Error).message })),
      )
      .finally(() => setLoading(false));
  }, [client, open, agentId, t]);

  useEffect(() => {
    if (!open) return;
    setEntriesLoading(true);
    client
      .listAgentMemoryEntries(agentId, search)
      .then((list: AgentMemoryEntry[]) => setEntries(list))
      .catch(() => setEntries([]))
      .finally(() => setEntriesLoading(false));
  }, [client, open, agentId, search]);

  function handleSearchChange(value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(value), 300);
  }

  const coreOverLimit = core.length > coreLimit;

  async function handleSave() {
    if (coreOverLimit) return;
    setSaving(true);
    try {
      await client.updateAgentMemory(agentId, { enabled, core });
      toast.success(t("agent-memory.saved"));
      onOpenChange(false);
    } catch (err) {
      toast.error(t("agent-memory.saveFailed", { message: (err as Error).message }));
    } finally {
      setSaving(false);
    }
  }

  function handleStartEdit(entry: AgentMemoryEntry) {
    setEditingId(entry.id);
    setEntryDraft({ content: entry.content, tags: (entry.tags ?? []).join(", ") });
  }

  async function handleSaveEntry() {
    if (editingId === null) return;
    try {
      const updated = await client.updateAgentMemoryEntry(agentId, editingId, {
        content: entryDraft.content,
        tags: parseTags(entryDraft.tags),
      });
      setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setEditingId(null);
    } catch (err) {
      toast.error(t("agent-memory.entrySaveFailed", { message: (err as Error).message }));
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    try {
      await client.deleteAgentMemoryEntry(agentId, deleteTarget.id);
      setEntries((prev) => prev.filter((e) => e.id !== deleteTarget.id));
    } catch (err) {
      toast.error(t("agent-memory.entryDeleteFailed", { message: (err as Error).message }));
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] flex-col sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>
            {agentName ? `${t("agent-memory.dialogTitle")} | ${agentName}` : t("agent-memory.dialogTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium">{t("agent-memory.enableLabel")}</p>
                  <p className="text-xs text-muted-foreground">{t("agent-memory.enableHint")}</p>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={(checked) => setEnabled(checked === true)}
                  aria-label={t("agent-memory.enableLabel")}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-medium">{t("agent-memory.coreLabel")}</p>
                  <span
                    className={
                      coreOverLimit ? "text-xs text-destructive" : "text-xs text-muted-foreground"
                    }
                  >
                    {t("agent-memory.charCount", { current: core.length, limit: coreLimit })}
                  </span>
                </div>
                <Textarea
                  value={core}
                  onChange={(e) => setCore(e.target.value)}
                  placeholder={t("agent-memory.corePlaceholder")}
                  className="min-h-[120px] font-mono text-xs"
                  aria-label={t("agent-memory.coreLabel")}
                />
                {coreOverLimit && (
                  <p className="text-xs text-destructive">{t("agent-memory.coreOverLimit")}</p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{t("agent-memory.entriesLabel")}</p>
                  <div className="relative ms-auto w-52">
                    <SearchIcon className="absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      defaultValue=""
                      onChange={(e) => handleSearchChange(e.target.value)}
                      placeholder={t("agent-memory.searchPlaceholder")}
                      className="h-7 ps-7 text-xs"
                      aria-label={t("agent-memory.searchPlaceholder")}
                    />
                  </div>
                </div>
                {entriesLoading ? (
                  <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
                ) : entries.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {t("agent-memory.entriesEmpty")}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {entries.map((entry) => (
                      <li key={entry.id} className="rounded-md border border-border p-2.5">
                        {editingId === entry.id ? (
                          <div className="space-y-2">
                            <Textarea
                              value={entryDraft.content}
                              onChange={(e) =>
                                setEntryDraft((prev) => ({ ...prev, content: e.target.value }))
                              }
                              className="min-h-[70px] text-xs"
                              aria-label={t("agent-memory.entryContentLabel")}
                            />
                            <Input
                              value={entryDraft.tags}
                              onChange={(e) =>
                                setEntryDraft((prev) => ({ ...prev, tags: e.target.value }))
                              }
                              placeholder={t("agent-memory.entryTagsPlaceholder")}
                              className="h-7 text-xs"
                              aria-label={t("agent-memory.entryTagsLabel")}
                            />
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setEditingId(null)}
                              >
                                {t("common.cancel")}
                              </Button>
                              <Button type="button" size="sm" onClick={handleSaveEntry}>
                                {t("common.save")}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="whitespace-pre-wrap break-words text-sm">
                                {entry.content}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                {(entry.tags ?? []).map((tag) => (
                                  <Badge key={tag} variant="secondary" className="text-[10px]">
                                    {tag}
                                  </Badge>
                                ))}
                                <span className="ms-auto text-[10px] text-muted-foreground">
                                  {formatTime(entry.updatedAt, locale)}
                                </span>
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-6"
                              onClick={() => handleStartEdit(entry)}
                              aria-label={t("common.edit")}
                            >
                              <PencilIcon className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-6 text-destructive"
                              onClick={() => setDeleteTarget(entry)}
                              aria-label={t("common.delete")}
                            >
                              <Trash2Icon className="size-3.5" />
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || coreOverLimit}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(next) => { if (!next) setDeleteTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("agent-memory.confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("agent-memory.confirmDeleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleConfirmDelete}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
