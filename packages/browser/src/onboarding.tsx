import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useHostBridge } from "@spherse/app/host-bridge-context";
import { useAppStore } from "@spherse/app/stores/app";
import type { RestoredProject } from "@spherse/app/host-bridge";

export function LocalOnboarding() {
  const navigate = useNavigate();
  const bridge = useHostBridge();
  const refreshProjects = useAppStore((state) => state.refreshProjects);
  const [projects, setProjects] = useState<RestoredProject[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void bridge.project?.restoreProjects().then((restored) => setProjects(restored ?? []));
  }, [bridge]);

  const open = async (projectId: string) => {
    await bridge.project?.setLastActiveProject(projectId);
    await refreshProjects(bridge);
    navigate(`/project/${projectId}`);
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy || !bridge.project) return;
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.project.openProject(trimmed);
      if (!result) throw new Error("project creation returned no id");
      await open(result.projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-neutral-50">
      <div className="w-full max-w-md space-y-6 p-8">
        <h1 className="text-2xl font-semibold">Spherse</h1>
        {projects.length > 0 && (
          <div className="space-y-2">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className="w-full rounded-lg border border-neutral-200 bg-white p-4 text-left hover:border-neutral-400"
                onClick={() => void open(project.id)}
              >
                <div className="font-medium">{project.name}</div>
              </button>
            ))}
          </div>
        )}
        <div className="space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
            placeholder="新项目名称"
            className="w-full rounded-lg border border-neutral-200 bg-white p-3 outline-none focus:border-neutral-500"
            disabled={busy}
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy || !name.trim()}
            className="w-full rounded-lg bg-neutral-900 p-3 font-medium text-white disabled:opacity-50"
          >
            {busy ? "创建中…" : "创建项目"}
          </button>
          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>
      </div>
    </div>
  );
}
