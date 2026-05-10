import { useState, useEffect, useMemo, useRef } from "react";
import type { AppContext } from "../lib/context";
import { FileTree } from "../components/FileTree";
import { CreateAgentDialog } from "../components/CreateAgentDialog";
import { ChatPage } from "./ChatPage";
import { SettingsModal } from "../components/SettingsModal";
import { ContentBrowser } from "./ContentBrowser";
import type { AgentProfile, SessionInfo } from "../lib/types";

type ViewMode = "chat" | "content";

interface ProjectPageProps {
  ctx: AppContext;
}

export function ProjectPage({ ctx }: ProjectPageProps) {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentProfile | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("chat");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menuAgentId, setMenuAgentId] = useState<string | null>(null);
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null);
  const agentMenuRef = useRef<HTMLDivElement>(null);
  const sessionMenuRef = useRef<HTMLDivElement>(null);

  const refreshAgents = () => {
    ctx.client.listAgents().then(setAgents).catch(console.error);
  };

  const refreshSessions = () => {
    ctx.client.listSessions().then(setSessions).catch(console.error);
  };

  useEffect(() => {
    refreshAgents();
    refreshSessions();
  }, [ctx]);

  useEffect(() => {
    if (agents.length > 0 && collapsed.size === 0) {
      setCollapsed(new Set(agents.slice(1).map((a) => a.id)));
    }
  }, [agents]);

  useEffect(() => {
    if (!menuAgentId && !menuSessionId) return;
    const handler = (e: MouseEvent) => {
      const inAgentMenu = agentMenuRef.current?.contains(e.target as Node);
      const inSessionMenu = sessionMenuRef.current?.contains(e.target as Node);
      if (!inAgentMenu && !inSessionMenu) {
        setMenuAgentId(null);
        setMenuSessionId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuAgentId, menuSessionId]);

  const grouped = useMemo(() => {
    const map = new Map<string, SessionInfo[]>();
    for (const s of sessions) {
      const list = map.get(s.agentId) ?? [];
      list.push(s);
      map.set(s.agentId, list);
    }
    return map;
  }, [sessions]);

  const toggleCollapse = (agentId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };

  const handleSelectSession = (session: SessionInfo) => {
    const agent = agents.find((a) => a.id === session.agentId);
    if (!agent) return;
    setSelectedSession(session);
    setSelectedAgent(agent);
    setViewMode("chat");
  };

  const handleNewSession = async (agent: AgentProfile) => {
    setMenuAgentId(null);
    const { sessionId: sid } = await ctx.client.createSession(agent.id);
    refreshSessions();
    const newSession: SessionInfo = {
      id: sid,
      agentId: agent.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "active",
    };
    setSelectedSession(newSession);
    setSelectedAgent(agent);
    setViewMode("chat");
  };

  const handleDeleteSession = async (sessionId: string) => {
    setMenuSessionId(null);
    await ctx.client.deleteSession(sessionId);
    if (selectedSession?.id === sessionId) {
      setSelectedSession(null);
      setSelectedAgent(null);
    }
    refreshSessions();
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
    <div className="flex h-full">
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
          {agents.length === 0 ? (
            <p className="text-xs text-[var(--faint)]">暂无 Agent 定义</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {agents.map((agent) => {
                const agentSessions = grouped.get(agent.id) ?? [];
                const isCollapsed = collapsed.has(agent.id);
                return (
                  <div key={agent.id} className="relative">
                    <div className="flex items-center gap-1 px-2 py-1.5 rounded hover:bg-[var(--hover)] group">
                      <button
                        className="w-5 h-5 flex items-center justify-center text-[var(--secondary)] shrink-0 text-[13px] transition-transform hover:bg-[var(--muted-bg)] rounded"
                        style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0)" }}
                        onClick={() => toggleCollapse(agent.id)}
                      >
                        ▾
                      </button>
                      <span className="text-[13px] font-medium overflow-hidden text-ellipsis whitespace-nowrap flex-1">{agent.name}</span>
                      <button
                        className="w-4 h-4 flex items-center justify-center text-[var(--secondary)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuAgentId(menuAgentId === agent.id ? null : agent.id);
                        }}
                      >
                        ···
                      </button>
                    </div>
                    {menuAgentId === agent.id && (
                      <div
                        ref={agentMenuRef}
                        className="absolute right-0 top-8 z-10 bg-surface border border-[var(--border)] rounded-md shadow-lg py-1 min-w-[120px]"
                      >
                        <button
                          className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-[var(--hover)] transition-colors"
                          onClick={() => handleNewSession(agent)}
                        >
                          新建对话
                        </button>
                      </div>
                    )}
                    {!isCollapsed && agentSessions.length > 0 && (
                      <ul className="list-none ml-3 border-l border-[var(--border-light)]">
                        {agentSessions.map((session) => (
                          <li key={session.id}>
                            <div
                              className={`group flex items-center gap-1 pl-2 py-1 text-[12px] cursor-pointer transition-colors hover:bg-[var(--hover)] rounded-r ${selectedSession?.id === session.id ? "bg-[var(--active-bg)] text-[var(--primary)] font-medium" : "text-[var(--secondary)]"}`}
                              onClick={() => handleSelectSession(session)}
                            >
                              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                                {session.title ?? new Date(session.updatedAt).toLocaleString()}
                              </span>
                              <span className="relative">
                                <button
                                  className="w-4 h-4 flex items-center justify-center text-[var(--secondary)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMenuSessionId(menuSessionId === session.id ? null : session.id);
                                  }}
                                >
                                  ···
                                </button>
                                {menuSessionId === session.id && (
                                  <div
                                    ref={sessionMenuRef}
                                    className="absolute right-0 top-5 z-10 bg-surface border border-[var(--border)] rounded-md shadow-lg py-1 min-w-[80px]"
                                  >
                                    <button
                                      className="w-full px-3 py-1.5 text-left text-[12px] text-danger hover:bg-[var(--hover)] transition-colors"
                                      onClick={() => handleDeleteSession(session.id)}
                                    >
                                      删除
                                    </button>
                                  </div>
                                )}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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
        {viewMode === "chat" && selectedSession && selectedAgent ? (
          <ChatPage client={ctx.client} sessionId={selectedSession.id} agent={selectedAgent} />
        ) : viewMode === "content" && selectedFile ? (
          <ContentBrowser
            client={ctx.client}
            filePath={selectedFile}
            onBack={handleBackToChat}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-[var(--muted)]">
            <p>点击 Agent 开始新对话，或选择已有会话</p>
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
