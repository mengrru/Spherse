import { useState } from "react";
import type { AppContext } from "../lib/context";
import { initAppContext } from "../lib/context";

interface HomePageProps {
  onProjectReady: (ctx: AppContext) => void;
}

export function HomePage({ onProjectReady }: HomePageProps) {
  const [status, setStatus] = useState("选择一个世界观项目文件夹开始");
  const [loading, setLoading] = useState(false);

  const handleOpenProject = async () => {
    const dir = await window.electronAPI.selectDirectory();
    if (!dir) return;
    setLoading(true);
    setStatus("正在启动服务器...");
    try {
      const port = await window.electronAPI.startServer(dir);
      setStatus(`服务器已启动 (port ${port})`);
      onProjectReady(initAppContext(port, dir));
    } catch (err: any) {
      setStatus(`启动失败: ${err.message}`);
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-base">
      <div className="text-center p-12 bg-surface rounded-xl shadow-[var(--shadow-card)]">
        <h1 className="text-[32px] font-bold mb-2 text-[var(--primary)]">Worldbuilding Agent</h1>
        <p className="text-base text-[var(--secondary)] mb-6">AI 辅助世界观创作工具</p>
        <p className="text-sm text-[var(--muted)] mb-4">{status}</p>
        <button
          className="px-8 py-2.5 bg-accent text-white rounded-md text-base transition-colors hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed"
          onClick={handleOpenProject}
          disabled={loading}
        >
          {loading ? "启动中..." : "打开项目"}
        </button>
      </div>
    </div>
  );
}
