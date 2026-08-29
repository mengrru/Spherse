import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useHostBridge } from "../../context/host-bridge-context";
import { useI18n } from "@spherse/i18n/react";
import type { TranslationKey } from "@spherse/i18n";
import { Button } from "../../components/ui/button";
import { Field, FieldGroup, FieldLabel } from "../../components/ui/field";
import { Switch } from "../../components/ui/switch";
import { SectionTitle } from "./SectionTitle";
import { Input } from "../../components/ui/input";
import { toast } from "sonner";
import type {
  MobileAccessState,
  MobileTunnelMode,
  TunnelStatus,
} from "../../lib/host-bridge";
import { useAppStore } from "../../stores/app-store";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { useLocation } from "react-router";
import { Copy, RefreshCw } from "lucide-react";
import { WEB_APP_URL } from "../../lib/urls";

const CLOUDFLARE_DOCS_URL = "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/";

function buildDeeplink(publicUrl: string, token: string, targetPath?: string): string {
  const params = new URLSearchParams({ base: publicUrl, token });
  if (targetPath) {
    params.set("targetPath", targetPath);
  }
  return `${WEB_APP_URL}#/?${params.toString()}`;
}

function statusTranslationKey(status: TunnelStatus): TranslationKey {
  switch (status) {
    case "stopped": return "settings.mobile.tunnelStatus.stopped";
    case "starting": return "settings.mobile.tunnelStatus.starting";
    case "running": return "settings.mobile.tunnelStatus.running";
    case "error": return "settings.mobile.tunnelStatus.error";
  }
}

function maskToken(token: string | null): string {
  if (!token) return "";
  if (token.length <= 12) return "•".repeat(token.length);
  return `${token.slice(0, 6)}${"•".repeat(16)}${token.slice(-4)}`;
}

type WorkKind = null | "enable" | "disable" | "regenerate" | "restart" | "mode" | "domain";

export function MobileAccessPanel() {
  const { t } = useI18n();
  const bridge = useHostBridge();
  const mobile = bridge.mobile;
  const [state, setState] = useState<MobileAccessState | null>(null);
  const [working, setWorking] = useState<WorkKind>(null);
  const [revealToken, setRevealToken] = useState(false);
  const location = useLocation();
  const [domainDraft, setDomainDraft] = useState("");

  useEffect(() => {
    if (!mobile) return;
    let mounted = true;
    void mobile.getMobileAccessState().then((s) => {
      if (mounted) {
        setState(s);
        setDomainDraft(s.manualDomain ?? "");
      }
    });
    const off = mobile.onMobileAccessEvent((event) => {
      if (mounted && event.type === "state") {
        setState(event.state);
        setDomainDraft(event.state.manualDomain ?? "");
      }
    });
    return () => {
      mounted = false;
      off();
    };
  }, [mobile]);

  if (!mobile) return null;

  async function run(action: WorkKind, fn: () => Promise<MobileAccessState>): Promise<void> {
    setWorking(action);
    try {
      const next = await fn();
      setState(next);
      if (action === "domain") {
        setDomainDraft(next.manualDomain ?? "");
      }
      if (action === "enable" || action === "disable" || action === "regenerate" || action === "mode") {
        void useAppStore.getState().refreshConnection(bridge);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("cloudflared") || message.includes("spawn")) {
        toast.error(t("settings.mobile.cloudflaredMissing"));
      } else {
        toast.error(message);
      }
    } finally {
      setWorking(null);
    }
  }

  const enabled = state?.enabled ?? false;
  const mode: MobileTunnelMode = state?.mode ?? "quick";
  const tunnelStatus = state?.tunnel?.status ?? "stopped";
  const serverPort = state?.serverPort ?? null;
  const publicUrl = state?.tunnel?.publicUrl ?? null;
  const token = state?.token ?? null;
  const targetPath = location.pathname.startsWith("/project/") ? location.pathname : undefined;
  const showQR = mode === "manual"
    ? Boolean(publicUrl && token)
    : Boolean(enabled && publicUrl && token);
  const deeplink = showQR && publicUrl && token ? buildDeeplink(publicUrl, token, targetPath) : null;

  function selectMode(next: MobileTunnelMode): void {
    if (next === mode || working !== null) return;
    void run("mode", () => mobile!.setMobileMode(next));
  }

  return (
    <FieldGroup>
      <p className="text-xs text-muted-foreground leading-relaxed">{t("settings.mobile.description")}</p>

      <Field className="mt-3">
        <SectionTitle as={FieldLabel}>{t("settings.mobile.mode")}</SectionTitle>
        <div className="flex gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={mode === "quick" ? "default" : "outline"}
                  size="sm"
                  className="h-8"
                  disabled={enabled || working !== null}
                  onClick={() => selectMode("quick")}
                >
                  {t("settings.mobile.mode.quick")}
                </Button>
              }
            />
            <TooltipContent side="bottom" className="max-w-xs">{t("settings.mobile.mode.quickHint")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={mode === "manual" ? "default" : "outline"}
                  size="sm"
                  className="h-8"
                  disabled={enabled || working !== null}
                  onClick={() => selectMode("manual")}
                >
                  {t("settings.mobile.mode.manual")}
                </Button>
              }
            />
            <TooltipContent side="bottom" className="max-w-xs">{t("settings.mobile.mode.manualHint")}</TooltipContent>
          </Tooltip>
        </div>
      </Field>

      {mode === "quick" && (
        <div className="flex items-center justify-between gap-3 mt-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium leading-none">{t("settings.mobile.enable")}</span>
          </div>
          <Switch
            checked={enabled}
            disabled={working !== null}
            onCheckedChange={(checked) => {
              if (checked) {
                void run("enable", () => mobile.enableMobileAccess({ mode: "quick" }));
              } else {
                void run("disable", () => mobile.disableMobileAccess());
              }
            }}
          />
        </div>
      )}

      {mode === "quick" && !enabled && (
        <p className="text-xs text-warning leading-relaxed">
          {t("settings.mobile.cloudflaredPrerequisite")}
        </p>
      )}

      {mode === "quick" && enabled ? (
        <>
          <Field className="mt-4">
            <SectionTitle as={FieldLabel}>{t("settings.mobile.tunnelStatus")}</SectionTitle>
            <div className="flex items-center gap-2">
              <span className="text-sm">{t(statusTranslationKey(tunnelStatus))}</span>
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                disabled={working !== null}
                onClick={() => void run("restart", () => mobile.restartTunnel())}
              >
                <RefreshCw className="size-3.5" />
                {working === "restart" ? t("settings.mobile.working") : t("settings.mobile.restartTunnel")}
              </Button>
            </div>
            {state?.tunnel?.error && tunnelStatus === "error" && (
              <p className="text-xs text-destructive mt-1 break-words">{state.tunnel.error}</p>
            )}
          </Field>

          <Field className="mt-3">
            <SectionTitle as={FieldLabel}>{t("settings.mobile.publicUrl")}</SectionTitle>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={publicUrl ?? ""}
                className="text-xs h-8"
                placeholder="—"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={!publicUrl}
                onClick={() => {
                  if (!publicUrl) return;
                  void navigator.clipboard.writeText(publicUrl).then(() => toast.success(t("settings.mobile.urlCopied")));
                }}
              >
                <Copy className="size-3.5" />
                {t("settings.mobile.copyUrl")}
              </Button>
            </div>
          </Field>
        </>
      ) : null}

      {mode === "manual" && (
        <>
          <Field className="mt-4">
            <SectionTitle as={FieldLabel}>{t("settings.mobile.serverUrl")}</SectionTitle>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={serverPort ? `http://localhost:${serverPort}` : "—"}
                className="text-xs h-8 font-mono"
                placeholder="—"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={!serverPort}
                onClick={() => {
                  if (!serverPort) return;
                  void navigator.clipboard.writeText(`http://localhost:${serverPort}`).then(() => toast.success(t("settings.mobile.serverUrlCopied")));
                }}
              >
                <Copy className="size-3.5" />
                {t("settings.mobile.copyServerUrl")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {t("settings.mobile.manualSetupHint")}
            </p>
            <Button
              variant="link"
              size="sm"
              className="h-7 p-0 mt-1 text-xs justify-start"
              onClick={() => void bridge.openExternal(CLOUDFLARE_DOCS_URL)}
            >
              {t("settings.mobile.cloudflareDocs")}
            </Button>
          </Field>

          <Field className="mt-3">
            <SectionTitle as={FieldLabel}>{t("settings.mobile.manualDomain")}</SectionTitle>
            <div className="flex items-center gap-2">
              <Input
                value={domainDraft}
                onChange={(e) => setDomainDraft(e.target.value)}
                className="text-xs h-8"
                placeholder="https://spherse.example.com"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={working !== null}
                onClick={() => void run("domain", () => mobile.setPublicDomain(domainDraft))}
              >
                {working === "domain" ? t("settings.mobile.working") : t("settings.mobile.saveDomain")}
              </Button>
            </div>
          </Field>
        </>
      )}

      {(mode === "manual" || enabled) && (
        <>
          <Field className="mt-3">
            <SectionTitle as={FieldLabel}>{t("settings.mobile.token")}</SectionTitle>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                type={revealToken ? "text" : "password"}
                value={revealToken ? (token ?? "") : maskToken(token)}
                onChange={() => undefined}
                className="text-xs h-8 font-mono"
                placeholder="—"
              />
              <Button variant="outline" size="sm" className="h-8" onClick={() => setRevealToken((v) => !v)}>
                {revealToken ? t("settings.mobile.tokenHide") : t("settings.mobile.tokenShow")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={!token}
                onClick={() => {
                  if (!token) return;
                  void navigator.clipboard.writeText(token).then(() => toast.success(t("settings.mobile.tokenCopied")));
                }}
              >
                <Copy className="size-3.5" />
                {t("settings.mobile.copyToken")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{t("settings.mobile.tokenHint")}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 h-8"
              disabled={working !== null}
              onClick={() => {
                if (window.confirm(t("settings.mobile.regenerateConfirm"))) {
                  void run("regenerate", () => mobile.regenerateToken());
                }
              }}
            >
              <RefreshCw className="size-3.5" />
              {working === "regenerate" ? t("settings.mobile.working") : t("settings.mobile.regenerateToken")}
            </Button>
          </Field>

          <Field className="mt-4">
            <SectionTitle as={FieldLabel}>{t("settings.mobile.scanQr")}</SectionTitle>
            <p className="text-xs text-muted-foreground leading-relaxed">{t("settings.mobile.qrWarning")}</p>
            {deeplink ? (
              <div className="mt-2 flex justify-center p-3 bg-white rounded-md w-fit mx-auto">
                <QrImage value={deeplink} />
              </div>
            ) : mode === "manual" ? (
              <p className="text-xs text-muted-foreground">{t("settings.mobile.manualDomainEmpty")}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{t("settings.mobile.working")}</p>
            )}
          </Field>
        </>
      )}
    </FieldGroup>
  );
}

function QrImage({ value }: { value: string }) {
  const [dataUrl, setDataUrl] = useState<string>("");
  useEffect(() => {
    QRCode.toDataURL(value, { width: 256, margin: 1, errorCorrectionLevel: "M" })
      .then(setDataUrl)
      .catch(() => setDataUrl(""));
  }, [value]);
  if (!dataUrl) return null;
  return <img src={dataUrl} alt="QR" width={192} height={192} />;
}
