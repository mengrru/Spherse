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
    <div className="home-page">
      <div className="home-card">
        <h1 className="home-title">Worldbuilding Agent</h1>
        <p className="home-subtitle">AI 辅助世界观创作工具</p>
        <p className="home-status">{status}</p>
        <button
          className="home-btn"
          onClick={handleOpenProject}
          disabled={loading}
        >
          {loading ? "启动中..." : "打开项目"}
        </button>
      </div>
    </div>
  );
}
