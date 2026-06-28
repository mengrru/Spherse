import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@spherse/i18n/react";
import type { ApiClient } from "../../lib/api";

export function normalizeAiDeniedPath(input: string): string | null {
  const trimmed = input.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed === "." || trimmed.startsWith("/") || trimmed.includes("..")) return null;
  const normalized = trimmed.replace(/^\.\//, "").replace(/\/+/g, "/");
  if (!normalized) return null;
  if (
    normalized === "AGENTS.md" ||
    normalized === "CHANGELOG.md" ||
    normalized === ".spherse" ||
    normalized.startsWith(".spherse/")
  ) {
    return null;
  }
  return normalized;
}

export function useAiReadDenylist(client: ApiClient, open: boolean) {
  const { t } = useI18n();
  const [paths, setPaths] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    client
      .getAiAccessSettings()
      .then((settings) => setPaths(settings.deniedPaths))
      .catch((err: unknown) =>
        toast.error(t("ai-read-denylist.loadFailed", { message: (err as Error).message })),
      )
      .finally(() => setLoading(false));
  }, [client, open, t]);

  const addInput = () => {
    const normalized = normalizeAiDeniedPath(input);
    if (!normalized) {
      toast.error(t("ai-read-denylist.invalidPath"));
      return;
    }
    if (paths.includes(normalized)) {
      toast.error(t("ai-read-denylist.pathExists"));
      return;
    }
    setPaths((current) => [...current, normalized]);
    setInput("");
  };

  const removePath = (path: string) => {
    setPaths((current) => current.filter((item) => item !== path));
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await client.updateAiAccessSettings(paths);
      setPaths(result.deniedPaths);
      toast.success(t("ai-read-denylist.saved"));
      return true;
    } catch (err) {
      toast.error(t("ai-read-denylist.saveFailed", { message: (err as Error).message }));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { paths, input, saving, loading, setInput, addInput, removePath, save };
}
