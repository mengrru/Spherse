import { useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { FloatingFrame } from "../../components/floating-frame";
import { useHostBridge } from "../../context/host-bridge-context";
import { useBrowserStore, type BrowserWindow } from "./store";
import { BrowserToolbar } from "./BrowserToolbar";
import { BrowserView } from "./BrowserView";

interface FloatingBrowserContainerProps {
  projectId: string;
  window: BrowserWindow;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function FloatingBrowserContainer({ projectId, window: floatWindow }: FloatingBrowserContainerProps) {
  const { url, position, size } = floatWindow;
  const navigate = useNavigate();
  const bridge = useHostBridge();
  const [refreshKey, setRefreshKey] = useState(0);
  const closeFloat = useBrowserStore((s) => s.closeFloat);
  const navigateFloat = useBrowserStore((s) => s.navigateFloat);
  const setPosition = useBrowserStore((s) => s.setPosition);
  const setSize = useBrowserStore((s) => s.setSize);

  const expandToPage = () => {
    closeFloat(projectId, url);
    navigate(`/project/${projectId}/browser?url=${encodeURIComponent(url)}`);
  };

  return createPortal(
    <FloatingFrame
      hookPrefix="browser"
      title={hostOf(url)}
      position={position}
      size={size}
      onPositionCommit={(pos) => setPosition(projectId, url, pos)}
      onSizeCommit={(newSize, pos) => setSize(projectId, url, newSize, pos)}
      onClose={() => closeFloat(projectId, url)}
      onExpand={expandToPage}
    >
      <div className="flex h-full flex-col">
        <BrowserToolbar
          url={url}
          mode="float"
          onNavigate={(newUrl) => navigateFloat(projectId, url, newUrl)}
          onRefresh={() => setRefreshKey((k) => k + 1)}
          onOpenInSystem={() => void bridge.openExternal(url)}
          onToggleMode={expandToPage}
        />
        <div className="min-h-0 flex-1">
          <BrowserView url={url} refreshKey={refreshKey} />
        </div>
      </div>
    </FloatingFrame>,
    document.body,
  );
}
