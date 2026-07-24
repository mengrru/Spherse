import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@spherse/i18n/react";
import { PlusIcon, Trash2Icon, PencilIcon, AlertTriangleIcon } from "lucide-react";
import type { AgentMcpConfig, McpServerConfig } from "../../lib/types";
import { useApiClient } from "../../lib/use-connection";
import { useProjectDataStore } from "../../stores/project-data-store";
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
import { Switch } from "../../components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import {
  configToDraft,
  draftToConfig,
  emptyMcpDraft,
  type McpServerDraft,
} from "./mcp-form-helpers";
import { McpServerForm } from "./McpServerForm";

interface McpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  projectId: string;
}

export function McpDialog({ open, onOpenChange, agentId, projectId }: McpDialogProps) {
  const { t } = useI18n();
  const client = useApiClient(projectId);
  const agentName = useProjectDataStore(
    (s) => s.projects[projectId]?.agents?.find((a) => a.id === agentId)?.name ?? "",
  );
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<McpServerDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<McpServerConfig | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setDraft(null);
    setEditingId(null);
    setDeleteTarget(null);
    client
      .getAgentMcp(agentId)
      .then((config: AgentMcpConfig) => setServers(config.servers ?? []))
      .catch((err: unknown) =>
        toast.error(t("agent-mcp.loadFailed", { message: (err as Error).message })),
      )
      .finally(() => setLoading(false));
  }, [client, open, agentId, t]);

  function patchDraft(patch: Partial<McpServerDraft>) {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function handleSaveDraft() {
    if (!draft) return;
    const config = draftToConfig(draft);
    if (!config) {
      toast.error(t("agent-mcp.invalidServer"));
      return;
    }
    setServers((prev) => {
      const exists = prev.some((s) => s.id === config.id);
      return exists ? prev.map((s) => (s.id === config.id ? config : s)) : [...prev, config];
    });
    setDraft(null);
    setEditingId(null);
  }

  function handleStartEdit(server: McpServerConfig) {
    setDraft(configToDraft(server));
    setEditingId(server.id);
  }

  function handleStartCreate() {
    setDraft(emptyMcpDraft());
    setEditingId(null);
  }

  function handleToggle(server: McpServerConfig, enabled: boolean) {
    setServers((prev) =>
      prev.map((s) => (s.id === server.id ? ({ ...s, enabled } as McpServerConfig) : s)),
    );
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    setServers((prev) => prev.filter((s) => s.id !== deleteTarget.id));
    setDeleteTarget(null);
  }

  async function handleSaveAll() {
    setSaving(true);
    try {
      await client.updateAgentMcp(agentId, { servers });
      toast.success(t("agent-mcp.saved"));
      onOpenChange(false);
    } catch (err) {
      toast.error(t("agent-mcp.saveFailed", { message: (err as Error).message }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] flex-col sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            {agentName ? `${t("agent-mcp.dialogTitle")} | ${agentName}` : t("agent-mcp.dialogTitle")}
            <Tooltip>
              <TooltipTrigger
                aria-label={t("agent-mcp.securityHint")}
                className="inline-flex cursor-help text-muted-foreground"
              >
                <AlertTriangleIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{t("agent-mcp.securityHint")}</TooltipContent>
            </Tooltip>
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : (
            <>
              {draft ? (
                <McpServerForm
                  key={draft.id}
                  draft={draft}
                  onChange={patchDraft}
                  onSave={handleSaveDraft}
                  onCancel={() => {
                    setDraft(null);
                    setEditingId(null);
                  }}
                />
              ) : (
                <div className="flex justify-end">
                  <Button type="button" onClick={handleStartCreate}>
                    <PlusIcon className="size-4" />
                    {t("agent-mcp.addServer")}
                  </Button>
                </div>
              )}

              {servers.length === 0 && !draft ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t("agent-mcp.empty")}
                </p>
              ) : (
                <ul className="space-y-2">
                  {servers.map((server) => (
                    <li
                      key={server.id}
                      className="flex items-center gap-2 rounded-md border border-border p-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{server.name}</span>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                            {t(`agent-mcp.transport-${server.transport}`)}
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {server.transport === "stdio" ? server.command : server.url}
                        </p>
                      </div>
                      <Switch
                        checked={server.enabled}
                        onCheckedChange={(checked) => handleToggle(server, checked === true)}
                        aria-label={t("agent-mcp.toggleEnabled")}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleStartEdit(server)}
                        disabled={editingId === server.id}
                        aria-label={t("common.edit")}
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setDeleteTarget(server)}
                        aria-label={t("common.delete")}
                      >
                        <Trash2Icon />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={handleSaveAll} disabled={saving || draft !== null}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={!!deleteTarget} onOpenChange={(next) => { if (!next) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("agent-mcp.confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("agent-mcp.confirmDeleteDescription", {
                name: deleteTarget?.name ?? "",
              })}
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
