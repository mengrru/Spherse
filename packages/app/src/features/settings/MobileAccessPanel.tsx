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
import type { MobileAccessState, TunnelStatus } from "../../lib/host-bridge";
import { useAppStore } from "../../stores/app-store";
import { Copy, RefreshCw } from "lucide-react";

const WEB_APP_URL = "https://spherse.mengru.work/web/";

function buildDeeplink(publicUrl: string, token: string): string {
  const params = new URLSearchParams({ base: publicUrl, token });
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

export function MobileAccessPanel() {
  const { t } = useI18n();
  const bridge = useHostBridge();
  const mobile = bridge.mobile;
  const [state, setState] = useState<MobileAccessState | null>(null);
  const [working, setWorking] = useState<null | "enable" | "disable" | "regenerate" | "restart">(null);
  const [revealToken, setRevealToken] = useState(false);

  useEffect(() => {
    if (!mobile) return;
    let mounted = true;
    void mobile.getMobileAccessState().then((s) => {
      if (mounted) setState(s);
    });
    const off = mobile.onMobileAccessEvent((event) => {
      if (mounted && event.type === "state") setState(event.state);
    });
    return () => {
      mounted = false;
      off();
    };
  }, [mobile]);

  if (!mobile) return null;

  async function run(
    action: "enable" | "disable" | "regenerate" | "restart",
    fn: () => Promise<MobileAccessState>,
  ): Promise<void> {
    setWorking(action);
    try {
      const next = await fn();
      setState(next);
      if (action === "enable" || action === "disable" || action === "regenerate") {
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
  const tunnelStatus = state?.tunnel?.status ?? "stopped";
  const publicUrl = state?.tunnel?.publicUrl ?? null;
  const token = state?.token ?? null;
  const deeplink = enabled && publicUrl && token ? buildDeeplink(publicUrl, token) : null;

  return (
    <FieldGroup>
      <p className="text-xs text-muted-foreground leading-relaxed">{t("settings.mobile.description")}</p>

      <div className="flex items-center justify-between gap-3 mt-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium leading-none">{t("settings.mobile.enable")}</span>
        </div>
        <Switch
          checked={enabled}
          disabled={working !== null}
          onCheckedChange={(checked) => {
            if (checked) {
              void run("enable", () => mobile.enableMobileAccess());
            } else {
              void run("disable", () => mobile.disableMobileAccess());
            }
          }}
        />
      </div>

      {!enabled ? (
        <p className="text-xs text-muted-foreground mt-2">{t("settings.mobile.disabledHint")}</p>
      ) : (
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
            {deeplink ? (
              <div className="flex justify-center p-3 bg-white rounded-md w-fit mx-auto">
                <QrImage value={deeplink} />
              </div>
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
