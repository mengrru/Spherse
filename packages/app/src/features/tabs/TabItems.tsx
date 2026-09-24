import { useEffect } from "react";
import { FileIcon, GlobeIcon, HouseIcon, MessageSquareIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { useProjectCtx } from "../../context/project-context";
import { useTabsStore } from "../../stores/tabs-store";
import type { TabTarget } from "../../lib/tab-target";
import { fileDisplayName } from "../../lib/file-name";
import { TabShell, type TabDragProps } from "./TabShell";
import { useChatTabInfo } from "./use-chat-tab-info";

interface CommonProps {
  tabKey: string;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  drag?: TabDragProps;
}

export function WelcomeTab({ active, onSelect }: { active: boolean; onSelect: () => void }) {
  const { t } = useI18n();
  return (
    <TabShell
      tabKey="welcome"
      kind="welcome"
      icon={<HouseIcon />}
      label={t("tabs.welcome")}
      active={active}
      onSelect={onSelect}
    />
  );
}

function ChatTab({ sessionId, ...props }: CommonProps & { sessionId: string }) {
  const { t } = useI18n();
  const { projectId } = useProjectCtx();
  const info = useChatTabInfo(projectId, sessionId);
  const closeStoredTab = useTabsStore((s) => s.closeTab);

  useEffect(() => {
    if (info.gone) closeStoredTab(projectId, props.tabKey);
  }, [closeStoredTab, info.gone, projectId, props.tabKey]);

  const label = info.title ?? t("tabs.loading");
  const title = info.agentName && info.title ? `${info.agentName} · ${info.title}` : label;
  return <TabShell {...props} kind="chat" icon={<MessageSquareIcon />} label={label} title={title} />;
}

function browserLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return url;
  }
}

export function TargetTab({ target, ...props }: CommonProps & { target: TabTarget }) {
  switch (target.kind) {
    case "chat":
      return <ChatTab {...props} sessionId={target.sessionId} />;
    case "file":
      return <TabShell {...props} kind="file" icon={<FileIcon />} label={fileDisplayName(target.path)} title={target.path} />;
    case "browser":
      return <TabShell {...props} kind="browser" icon={<GlobeIcon />} label={browserLabel(target.url)} title={target.url} />;
  }
}
