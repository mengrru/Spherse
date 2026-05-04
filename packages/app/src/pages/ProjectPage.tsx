import { useState, useEffect } from "react";
import type { AppContext } from "../lib/context";
import { AgentList } from "../components/AgentList";
import { FileTree } from "../components/FileTree";
import { CreateAgentDialog } from "../components/CreateAgentDialog";
import { ChatPage } from "./ChatPage";
import { SettingsModal } from "../components/SettingsModal";
import { ContentBrowser } from "./ContentBrowser";
import type { AgentDefinition } from "../lib/types";

type ViewMode = "chat" | "content";

interface ProjectPageProps {
  ctx: AppContext;
}

export function ProjectPage({ ctx }: ProjectPageProps) {
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentDefinition | null>(null);
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

  const handleSelectAgent = async (agent: AgentDefinition) => {
    setSelectedAgent(agent);
    setViewMode("chat");
    const { sessionId: sid } = await ctx.client.createSession(agent.name);
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
    <div className="project-page">
      <aside className="sidebar">
        <div className="sidebar-section">
          <div className="sidebar-heading-row">
            <h3 className="sidebar-heading">Agents</h3>
            <button
              className="sidebar-add-btn"
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
        <div className="sidebar-section">
          <h3 className="sidebar-heading">文件</h3>
          <FileTree client={ctx.client} onSelectFile={handleSelectFile} />
        </div>
        <div className="sidebar-footer">
          <button className="settings-btn" onClick={() => setShowSettings(true)}>
            ⚙ 设置
          </button>
        </div>
      </aside>
      <main className="main-area">
        {viewMode === "chat" && sessionId ? (
          <ChatPage client={ctx.client} sessionId={sessionId} agent={selectedAgent!} />
        ) : viewMode === "content" && selectedFile ? (
          <ContentBrowser
            client={ctx.client}
            filePath={selectedFile}
            onBack={handleBackToChat}
          />
        ) : (
          <div className="empty-state">
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
