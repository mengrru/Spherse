import { useState, useEffect, useMemo } from "react";
import type { AppContext } from "../lib/context";
import { useCustomTheme } from "../hooks/useCustomTheme";
import { FileTree } from "../components/FileTree";
import { AgentDialog } from "../components/AgentDialog";
import { ChatPage } from "./ChatPage";
import { SettingsModal } from "../components/SettingsModal";
import { ContentBrowser } from "./ContentBrowser";
import type { AgentProfile, SessionInfo } from "../lib/types";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { ChevronDownIcon, MoreHorizontalIcon, PlusIcon, SettingsIcon } from "lucide-react";

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
  const [editAgent, setEditAgent] = useState<{ id: string; content: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [initialMessage, setInitialMessage] = useState<string | undefined>(undefined);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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

  useCustomTheme(ctx.projectRoot, ctx.port);

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
    setInitialMessage(undefined);
    const agent = agents.find((a) => a.id === session.agentId);
    if (!agent) return;
    setSelectedSession(session);
    setSelectedAgent(agent);
    setViewMode("chat");
  };

  const handleNewSession = async (agent: AgentProfile) => {
    setInitialMessage(undefined);
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

  const handleStartSession = async (
    agentId: string,
    selectedText: string,
    sourcePath: string,
    comment?: string,
  ) => {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;

    const parts = [`请处理以下来自「${sourcePath}」的内容：\n\n> ${selectedText}`];
    if (comment) parts.push(`\n\n${comment}`);
    const message = parts.join("");

    const { sessionId: sid } = await ctx.client.createSession(agentId);
    refreshSessions();

    const newSession: SessionInfo = {
      id: sid,
      agentId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "active",
    };

    setInitialMessage(message);
    setSelectedSession(newSession);
    setSelectedAgent(agent);
    setViewMode("chat");
  };

  const handleFileDeleted = (deletedPath: string) => {
    if (selectedFile && (selectedFile === deletedPath || selectedFile.startsWith(deletedPath + "/"))) {
      setSelectedFile(null);
      setViewMode("chat");
    }
  };

  const handleCreateAgent = async (filename: string, content: string) => {
    await ctx.client.createAgent(filename, content);
    setShowCreateAgent(false);
    refreshAgents();
  };

  const handleEditAgent = async (agent: AgentProfile) => {
    const raw = await ctx.client.getAgentRaw(agent.id);
    setEditAgent({ id: agent.id, content: raw });
  };

  const handleEditSubmit = async (_filename: string, content: string) => {
    if (!editAgent) return;
    await ctx.client.updateAgent(editAgent.id, content);
    setEditAgent(null);
    refreshAgents();
  };

  const handleDeleteAgent = async (agent: AgentProfile) => {
    const ok = window.confirm(`确定要删除 Agent「${agent.name}」吗？该 Agent 下的所有会话也将被移除。`);
    if (!ok) return;
    await ctx.client.deleteAgent(agent.id);
    if (selectedAgent?.id === agent.id) {
      setSelectedAgent(null);
      setSelectedSession(null);
    }
    refreshAgents();
    refreshSessions();
  };

  return (
    <div className="flex h-full flex-1 overflow-hidden">
      <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-background">
        <div className="border-b border-border p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="mb-0 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Agents</h3>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setShowCreateAgent(true)}
              title="创建 Agent"
            >
              <PlusIcon />
            </Button>
          </div>
          {agents.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无 Agent 定义</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {agents.map((agent) => {
                const agentSessions = grouped.get(agent.id) ?? [];
                const isCollapsed = collapsed.has(agent.id);
                return (
                  <div key={agent.id} className="relative">
                    <div className="group flex items-center gap-1 rounded px-2 py-1.5 hover:bg-muted">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="shrink-0 transition-transform"
                        style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0)" }}
                        onClick={() => toggleCollapse(agent.id)}
                      >
                        <ChevronDownIcon />
                      </Button>
                      <span className="text-[13px] font-medium overflow-hidden text-ellipsis whitespace-nowrap flex-1">{agent.name}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />}>
                          <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleNewSession(agent)}>
                            新建对话
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleEditAgent(agent)}>
                            编辑
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => handleDeleteAgent(agent)}>
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {!isCollapsed && agentSessions.length > 0 && (
                      <ul className="ml-3 list-none border-l border-border">
                        {agentSessions.map((session) => (
                          <li key={session.id}>
                            <div
                              className={`group flex cursor-pointer items-center gap-1 rounded-r py-1 pl-2 text-[12px] transition-colors hover:bg-muted ${selectedSession?.id === session.id ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground"}`}
                              onClick={() => handleSelectSession(session)}
                            >
                              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                                {session.title ?? new Date(session.updatedAt).toLocaleString()}
                              </span>
                              <DropdownMenu>
                                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />}>
                                  <MoreHorizontalIcon />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem variant="destructive" onClick={() => handleDeleteSession(session.id)}>
                                    删除
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
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
        <div className="border-b border-border p-3">
          <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">文件</h3>
          <FileTree client={ctx.client} onSelectFile={handleSelectFile} onDeleted={handleFileDeleted} />
        </div>
        <div className="mt-auto border-t border-border p-3">
          <Button variant="outline" className="w-full" onClick={() => setShowSettings(true)}>
            <SettingsIcon />
            设置
          </Button>
        </div>
      </aside>
      {/* ChatPage 用 hidden 隐藏而非卸载，保持对话滚动位置和组件状态 */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {selectedSession && selectedAgent && (
          <div className={viewMode === "chat" ? "contents" : "hidden"}>
            <ChatPage client={ctx.client} sessionId={selectedSession.id} agent={selectedAgent} onNavigateToPath={handleSelectFile} initialMessage={initialMessage} />
          </div>
        )}
        {/* ContentBrowser 不依赖 session，从文件树或 chat 内链接均可直接打开 */}
        {viewMode === "content" && selectedFile && (
          <ContentBrowser
            client={ctx.client}
            filePath={selectedFile}
            onBack={handleBackToChat}
            agents={agents}
            onStartSession={handleStartSession}
          />
        )}
        {viewMode !== "content" && !(selectedSession && selectedAgent) && (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <p>点击 Agent 开始新对话，或选择已有会话</p>
          </div>
        )}
      </main>
      {showCreateAgent && (
        <AgentDialog
          mode="create"
          client={ctx.client}
          onSubmit={handleCreateAgent}
          onCancel={() => setShowCreateAgent(false)}
        />
      )}
      {editAgent && (
        <AgentDialog
          mode="edit"
          initialContent={editAgent.content}
          client={ctx.client}
          onSubmit={handleEditSubmit}
          onCancel={() => setEditAgent(null)}
        />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
