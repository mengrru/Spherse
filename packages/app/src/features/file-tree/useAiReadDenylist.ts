import { useEffect, useState } from "react";
import { toast } from "sonner";
import { translate } from "@spherse/i18n";
import type { ApiClient } from "../../lib/api";
import { useSettingsStore } from "../settings/store";

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
  const [paths, setPaths] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const locale = useSettingsStore.getState().locale ?? "zh-CN";
    setLoading(true);
    client
      .getAiAccessSettings()
      .then((settings) => setPaths(settings.deniedPaths))
      .catch((err: unknown) =>
        toast.error(translate(locale, "ai-read-denylist.loadFailed", { message: (err as Error).message })),
      )
      .finally(() => setLoading(false));
  }, [client, open]);

  const addInput = () => {
    const locale = useSettingsStore.getState().locale ?? "zh-CN";
    const normalized = normalizeAiDeniedPath(input);
    if (!normalized) {
      toast.error(translate(locale, "ai-read-denylist.invalidPath"));
      return;
    }
    if (paths.includes(normalized)) {
      toast.error(translate(locale, "ai-read-denylist.pathExists"));
      return;
    }
    setPaths((current) => [...current, normalized]);
    setInput("");
  };

  const removePath = (path: string) => {
    setPaths((current) => current.filter((item) => item !== path));
  };

  const save = async () => {
    const locale = useSettingsStore.getState().locale ?? "zh-CN";
    setSaving(true);
    try {
      const result = await client.updateAiAccessSettings(paths);
      setPaths(result.deniedPaths);
      toast.success(translate(locale, "ai-read-denylist.saved"));
      return true;
    } catch (err) {
      toast.error(translate(locale, "ai-read-denylist.saveFailed", { message: (err as Error).message }));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { paths, input, saving, loading, setInput, addInput, removePath, save };
}
