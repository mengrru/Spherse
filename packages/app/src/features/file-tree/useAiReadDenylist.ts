import { useEffect, useState } from "react";
import { toast } from "sonner";
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
        toast.error(`读取 AI 读取限制失败：${(err as Error).message}`),
      )
      .finally(() => setLoading(false));
  }, [client, open]);

  const addInput = () => {
    const normalized = normalizeAiDeniedPath(input);
    if (!normalized) {
      toast.error("路径无效或不可加入限制列表");
      return;
    }
    if (paths.includes(normalized)) {
      toast.error("路径已存在");
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
      toast.success("AI 读取限制已保存");
      return true;
    } catch (err) {
      toast.error(`保存失败：${(err as Error).message}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { paths, input, saving, loading, setInput, addInput, removePath, save };
}
