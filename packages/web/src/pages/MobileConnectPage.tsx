import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { toast } from "sonner";
import { CameraIcon, KeyboardIcon, Loader2Icon } from "lucide-react";
import { Button } from "@spherse/app/ui/button";
import { WebDisconnectButton } from "@spherse/app/web-disconnect";
import type { ConnectPayload } from "@spherse/app/connect-payload";
import { useHostBridge } from "@spherse/app/host-bridge-context";
import { useAppStore } from "@spherse/app/stores/app";
import { useBusStore } from "@spherse/app/stores/bus";
import { runWebVersionGuard } from "../version-guard";
import { readWebConnection, WEB_CONNECTION_STORAGE_KEY } from "../host-bridge-web";
import { ScanPanel } from "./connect/ScanPanel";
import { ManualPanel } from "./connect/ManualPanel";

type Mode = "menu" | "scan" | "manual";

function persistConnection(conn: ConnectPayload): void {
  localStorage.setItem(
    WEB_CONNECTION_STORAGE_KEY,
    JSON.stringify({ baseUrl: conn.baseUrl.replace(/\/+$/, ""), token: conn.token }),
  );
}

export function MobileConnectPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const bridge = useHostBridge();
  const restoreProjects = useAppStore((state) => state.restoreProjects);
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>("menu");
  const [submitting, setSubmitting] = useState(false);
  const [manualBaseUrl, setManualBaseUrl] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [hasSavedConnection] = useState(() => Boolean(readWebConnection()?.baseUrl));

  const handleConnect = async (conn: ConnectPayload, targetPath?: string) => {
    setSubmitting(true);
    try {
      persistConnection(conn);
      let finish: (() => void) | undefined;
      const [firstProjectId, compatibility] = await Promise.all([
        restoreProjects(bridge, { initialGate: false }),
        runWebVersionGuard(() => finish?.()),
      ]);
      finish = () => {
        toast.success(t("mobile-connect.connected"));
        if (targetPath) {
          navigate(targetPath, { replace: true });
        } else if (firstProjectId) {
          navigate(`/project/${firstProjectId}`, { replace: true });
        } else {
          navigate("/", { replace: true });
        }
      };
      void useBusStore.getState().init(bridge);
      if (compatibility === "incompatible") return;
      finish();
    } catch (err) {
      toast.error(t("mobile-connect.connectFailed", { error: (err as Error).message }));
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    const base = searchParams.get("base");
    const token = searchParams.get("token");
    if (!base || !token) return;
    const path = searchParams.get("targetPath");
    const cleaned = new URLSearchParams(searchParams);
    cleaned.delete("base");
    cleaned.delete("token");
    cleaned.delete("targetPath");
    setSearchParams(cleaned, { replace: true });
    void handleConnect({ baseUrl: base, token }, path ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center overflow-auto bg-background px-6 text-foreground">
      <header className="mb-8 text-center">
        <h1 className="mb-2 text-3xl font-semibold">{t("mobile-connect.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("mobile-connect.subtitle")}</p>
      </header>

      {submitting ? (
        <div className="flex w-full max-w-sm flex-col items-center gap-3 py-8 text-muted-foreground">
          <Loader2Icon className="size-6 animate-spin" />
          <p className="text-sm">{t("mobile-connect.connecting")}</p>
        </div>
      ) : mode === "menu" ? (
        <div className="flex w-full max-w-sm flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" className="h-24 flex-col gap-2" onClick={() => setMode("scan")}>
              <CameraIcon className="size-7" />
              {t("mobile-connect.scan")}
            </Button>
            <Button variant="outline" className="h-24 flex-col gap-2" onClick={() => setMode("manual")}>
              <KeyboardIcon className="size-7" />
              {t("mobile-connect.manual")}
            </Button>
          </div>
          {hasSavedConnection && <WebDisconnectButton variant="panel" className="mt-4" />}
        </div>
      ) : mode === "scan" ? (
        <ScanPanel
          onDetected={(conn) => handleConnect(conn, conn.targetPath)}
          onSwitchToManual={() => setMode("manual")}
          onBack={() => setMode("menu")}
        />
      ) : (
        <ManualPanel
          baseUrl={manualBaseUrl}
          token={manualToken}
          submitting={submitting}
          onBaseUrlChange={setManualBaseUrl}
          onTokenChange={setManualToken}
          onBack={() => setMode("menu")}
          onSubmit={handleConnect}
        />
      )}
    </div>
  );
}
