import { useState, useEffect } from "react";
import type { AppContext } from "../lib/context";
import { AgentList } from "../components/AgentList";
import { FileTree } from "../components/FileTree";
import { CreateAgentDialog } from "../components/CreateAgentDialog";
import { ChatPage } from "./ChatPage";
import { SettingsModal } from "../components/SettingsModal";
import { ContentBrowser } from "./ContentBrowser";
import type { AgentProfile } from "../lib/types";

type ViewMode = "chat" | "content";

interface ProjectPageProps {
  ctx: AppContext;
}

export function ProjectPage({ ctx }: ProjectPageProps) {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentProfile | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("chat");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const refreshAgents = () => {
    ctx.client.listAgents().then(setAgents).catch(console.error);
  };

  useEffect(() => {
    refreshAgents();
  }, [ctx]);

  const handleSelectAgent = async (agent: AgentProfile) => {
    setSelectedAgent(agent);
    setViewMode("chat");
    const { sessionId: sid } = await ctx.client.createSession(agent.id);
    setSessionId(sid);
  };

  const handleSelectFile = (filePath: string) => {
    setSelectedFile(filePath);
    setViewMode("content");
  };

  const handleBackToChat = () => {
    setViewMode("chat");
  };

  const handleCreateAgent = async (filename: string, content: string) => {
    await ctx.client.createAgent(filename, content);
    setShowCreateAgent(false);
    refreshAgents();
  };

  return (
    <div className="flex h-screen">
      <aside className="w-60 bg-surface border-r border-[var(--border)] flex flex-col overflow-y-auto shrink-0">
        <div className="p-3 border-b border-[var(--border-light)]">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] mb-0">Agents</h3>
            <button
              className="w-[22px] h-[22px] flex items-center justify-center bg-[var(--muted-bg)] rounded text-[16px] text-[var(--secondary)] leading-none hover:bg-[var(--border)] hover:text-[var(--primary)]"
              onClick={() => setShowCreateAgent(true)}
              title="创建 Agent"
            >
              +
            </button>
          </div>
          <AgentList
            agents={agents}
            selectedAgent={selectedAgent}
            onSelect={handleSelectAgent}
          />
        </div>
        <div className="p-3 border-b border-[var(--border-light)]">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] mb-2">文件</h3>
          <FileTree client={ctx.client} onSelectFile={handleSelectFile} />
        </div>
        <div className="mt-auto p-3 border-t border-[var(--border-light)]">
          <button className="w-full py-2 bg-[var(--muted-bg)] rounded-md text-sm text-[var(--secondary)] text-center transition-colors hover:bg-[var(--hover-strong)] hover:text-[var(--primary)]" onClick={() => setShowSettings(true)}>
            ⚙ 设置
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-hidden flex flex-col">
        {viewMode === "chat" && sessionId ? (
          <ChatPage client={ctx.client} sessionId={sessionId} agent={selectedAgent!} />
        ) : viewMode === "content" && selectedFile ? (
          <ContentBrowser
            client={ctx.client}
            filePath={selectedFile}
            onBack={handleBackToChat}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-[var(--muted)]">
            <p>选择一个 Agent 开始对话，或浏览文件</p>
          </div>
        )}
      </main>
      {showCreateAgent && (
        <CreateAgentDialog
          onSubmit={handleCreateAgent}
          onCancel={() => setShowCreateAgent(false)}
        />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
