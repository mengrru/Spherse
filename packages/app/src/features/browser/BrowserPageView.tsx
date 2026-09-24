import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useHostBridge } from "../../context/host-bridge-context";
import { useBrowserStore } from "./store";
import { BrowserToolbar } from "./BrowserToolbar";
import { BrowserView } from "./BrowserView";
import { tabKey } from "../../lib/tab-target";
import type { NavState } from "../../lib/nav-state";

interface BrowserPageViewProps {
  projectId: string;
  url: string;
  onBack: () => void;
  onDetach: () => void;
}

export function BrowserPageView({ projectId, url, onBack, onDetach }: BrowserPageViewProps) {
  const navigate = useNavigate();
  const bridge = useHostBridge();
  const [refreshKey, setRefreshKey] = useState(0);
  const openFloat = useBrowserStore((s) => s.openFloat);

  return (
    <div className="flex h-full flex-col">
      <BrowserToolbar
        url={url}
        mode="page"
        leading={
          <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={onBack} title="Back" aria-label="Back">
            <ArrowLeftIcon />
          </Button>
        }
        onNavigate={(newUrl) =>
          navigate(`/project/${projectId}/browser?url=${encodeURIComponent(newUrl)}`, {
            state: { replaceTab: tabKey({ kind: "browser", url }) } satisfies NavState,
          })
        }
        onRefresh={() => setRefreshKey((k) => k + 1)}
        onOpenInSystem={() => void bridge.openExternal(url)}
        onToggleMode={() => {
          openFloat(projectId, url);
          onDetach();
        }}
      />
      <div className="min-h-0 flex-1">
        <BrowserView url={url} refreshKey={refreshKey} />
      </div>
    </div>
  );
}
