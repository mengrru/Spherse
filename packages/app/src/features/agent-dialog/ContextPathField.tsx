import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { isTextContextPath, CONTEXT_TOTAL_SIZE_LIMIT_BYTES } from "@spherse/presets";
import { useI18n } from "@spherse/i18n/react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { SearchFileField } from "./SearchFileField";
import { HintLabel } from "./HintLabel";
import { XIcon } from "lucide-react";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient } from "../../lib/use-connection";
import { projectQueryKeys } from "../../queries/keys";

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

export function ContextPathField({
  contextPaths,
  onAdd,
  onRemove,
}: {
  contextPaths: string[];
  onAdd: (path: string) => void;
  onRemove: (path: string) => void;
}) {
  const { t } = useI18n();
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);

  const usageQuery = useQuery({
    queryKey: projectQueryKeys.contextFilesUsage(projectId, contextPaths),
    queryFn: () => client.inspectContextFiles(contextPaths),
    enabled: contextPaths.length > 0,
  });

  const sizeByPath = useMemo(() => {
    const map = new Map<string, number>();
    for (const file of usageQuery.data ?? []) {
      if (file.exists) map.set(file.path, file.sizeBytes);
    }
    return map;
  }, [usageQuery.data]);

  const usedBytes = useMemo(
    () => contextPaths.reduce((sum, p) => sum + (sizeByPath.get(p) ?? 0), 0),
    [contextPaths, sizeByPath],
  );
  const overLimit = usedBytes > CONTEXT_TOTAL_SIZE_LIMIT_BYTES;
  const limitLabel = formatKb(CONTEXT_TOTAL_SIZE_LIMIT_BYTES);

  async function handleAdd(path: string) {
    if (contextPaths.includes(path)) return;
    if (!isTextContextPath(path)) {
      toast.error(t("agent-dialog.refsFormatError"));
      return;
    }
    try {
      const stats = await client.inspectContextFiles([...contextPaths, path]);
      const candidate = stats.find((s) => s.path === path);
      const totalWithout = stats
        .filter((s) => s.exists && s.path !== path)
        .reduce((sum, s) => sum + s.sizeBytes, 0);
      if (candidate?.exists && totalWithout + candidate.sizeBytes > CONTEXT_TOTAL_SIZE_LIMIT_BYTES) {
        toast.error(t("agent-dialog.refsSizeError", { limit: limitLabel }));
        return;
      }
      onAdd(path);
    } catch {
      toast.error(t("agent-dialog.refsInspectError"));
    }
  }

  return (
    <Field>
      <HintLabel hint={t("agent-dialog.refsHint")}>{t("agent-dialog.refsLabel")}</HintLabel>
      {contextPaths.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {contextPaths.map((path) => {
            const size = sizeByPath.get(path);
            return (
              <Badge
                key={path}
                variant="secondary"
                className="gap-1"
                title={size !== undefined ? `${path} · ${formatKb(size)}` : path}
              >
                {path}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="-mr-1 size-4"
                  onClick={() => onRemove(path)}
                >
                  <XIcon />
                </Button>
              </Badge>
            );
          })}
        </div>
      )}
      <SearchFileField
        exclude={contextPaths}
        onSelect={handleAdd}
        placeholder={t("agent-dialog.refsPlaceholder")}
        filter={isTextContextPath}
      />
      {contextPaths.length > 0 && !usageQuery.isError && (
        <p className={`text-xs ${overLimit ? "text-destructive" : "text-muted-foreground"}`}>
          {t("agent-dialog.refsUsage", { used: formatKb(usedBytes), limit: limitLabel })}
        </p>
      )}
    </Field>
  );
}
