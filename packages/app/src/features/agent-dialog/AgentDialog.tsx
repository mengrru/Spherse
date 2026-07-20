import { useState, useEffect } from "react";
import { AGENT_TEMPLATE } from "@spherse/presets";
import { useI18n } from "@spherse/i18n/react";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient } from "../../lib/use-connection";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { AgentDialogForm } from "./AgentDialogForm";

export interface LoadedAgentData {
  raw: string;
  theme: string;
}

interface AgentDialogProps {
  mode: "create" | "edit";
  agentId?: string;
  onSubmit: (slugBase: string, content: string, themeContent: string) => Promise<void>;
  onCancel: () => void;
}

export function AgentDialog({ mode, agentId, onSubmit, onCancel }: AgentDialogProps) {
  const { t } = useI18n();
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);
  const [data, setData] = useState<LoadedAgentData | null>(
    mode === "create" ? { raw: AGENT_TEMPLATE, theme: "" } : null,
  );
  const [loadErr, setLoadErr] = useState<unknown>(null);

  useEffect(() => {
    if (data || mode !== "edit" || !agentId) return;
    let cancelled = false;
    Promise.all([client.getAgentRaw(agentId), client.getAgentTheme(agentId)])
      .then(([raw, theme]) => {
        if (!cancelled) setData({ raw, theme });
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadErr(e);
      });
    return () => {
      cancelled = true;
    };
  }, [data, mode, agentId, client]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="h-[80vh] flex flex-col sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? t("agent-dialog.createTitle") : t("agent-dialog.editTitle")}
          </DialogTitle>
        </DialogHeader>
        {loadErr ? (
          <div className="flex flex-1 items-center justify-center text-sm text-destructive">
            {loadErr instanceof Error ? loadErr.message : t("agent-dialog.loadFailed")}
          </div>
        ) : data ? (
          <AgentDialogForm
            key={data.raw}
            initial={data}
            mode={mode}
            onSubmit={onSubmit}
            onCancel={onCancel}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {t("common.loading")}
          </div>
        )}
        {loadErr && (
          <DialogFooter>
            <Button variant="outline" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
