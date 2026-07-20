import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { toast } from "sonner";
import jsQR from "jsqr";
import { ArrowLeftIcon, CameraIcon, KeyboardIcon } from "lucide-react";
import { Button } from "@spherse/app/src/components/ui/button";
import { Input } from "@spherse/app/src/components/ui/input";
import { Field, FieldLabel } from "@spherse/app/src/components/ui/field";
import { useHostBridge } from "@spherse/app/src/context/host-bridge-context";
import { useAppStore } from "@spherse/app/src/stores/app-store";

const CONNECTION_STORAGE_KEY = "spherse:connection";
const DEEPLINK_PREFIX = "spherse://connect";
const SCAN_INTERVAL_MS = 250;

type Mode = "menu" | "scan" | "manual";

interface ParsedConnection {
  baseUrl: string;
  token: string;
}

function parseConnectionFromText(text: string): ParsedConnection | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(DEEPLINK_PREFIX)) return null;
  const queryStart = trimmed.indexOf("?");
  if (queryStart < 0) return null;
  const params = new URLSearchParams(trimmed.slice(queryStart + 1));
  const baseUrl = params.get("base");
  const token = params.get("token");
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

function persistConnection(conn: ParsedConnection): void {
  localStorage.setItem(
    CONNECTION_STORAGE_KEY,
    JSON.stringify({ baseUrl: conn.baseUrl, token: conn.token }),
  );
}

export function MobileConnectPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const bridge = useHostBridge();
  const restoreProjects = useAppStore((state) => state.restoreProjects);
  const [mode, setMode] = useState<Mode>("menu");
  const [submitting, setSubmitting] = useState(false);

  const handleConnect = async (conn: ParsedConnection) => {
    setSubmitting(true);
    try {
      persistConnection(conn);
      const firstProjectId = await restoreProjects(bridge);
      toast.success(t("mobile-connect.connected"));
      if (firstProjectId) {
        navigate(`/project/${firstProjectId}`, { replace: true });
      } else {
        navigate("/", { replace: true });
      }
    } catch (err) {
      toast.error(t("mobile-connect.connectFailed", { error: (err as Error).message }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center overflow-auto bg-background px-6 text-foreground">
      <header className="mb-8 text-center">
        <h1 className="mb-2 text-3xl font-semibold">{t("mobile-connect.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("mobile-connect.subtitle")}</p>
      </header>

      {mode === "menu" && (
        <div className="flex w-full max-w-sm flex-col gap-3">
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={() => setMode("scan")}
          >
            <CameraIcon className="size-4" />
            {t("mobile-connect.scan")}
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={() => setMode("manual")}
          >
            <KeyboardIcon className="size-4" />
            {t("mobile-connect.manual")}
          </Button>
        </div>
      )}

      {mode === "scan" && (
        <ScanPanel
          onBack={() => setMode("menu")}
          onDetected={handleConnect}
          onSwitchToManual={() => setMode("manual")}
        />
      )}

      {mode === "manual" && (
        <ManualPanel
          submitting={submitting}
          onBack={() => setMode("menu")}
          onSubmit={handleConnect}
        />
      )}
    </div>
  );
}

function ScanPanel({
  onBack,
  onDetected,
  onSwitchToManual,
}: {
  onBack: () => void;
  onDetected: (conn: ParsedConnection) => void | Promise<void>;
  onSwitchToManual: () => void;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detectedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!("mediaDevices" in navigator) || !navigator.mediaDevices?.getUserMedia) {
        setError(t("mobile-connect.scanUnavailable"));
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadeddata = () => {
            videoRef.current?.play().catch((err) => {
              console.warn("[scan] video.play() rejected", err);
            });
          };
        }
        scanTimerRef.current = setTimeout(tick, SCAN_INTERVAL_MS);
      } catch (err) {
        const name = (err as DOMException)?.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          setError(t("mobile-connect.cameraDenied"));
        } else {
          setError(t("mobile-connect.scanUnavailable"));
        }
      }
    }

    function tick() {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (detectedRef.current) return;
      if (!video || !canvas) {
        scanTimerRef.current = setTimeout(tick, SCAN_INTERVAL_MS);
        return;
      }
      if (video.readyState < video.HAVE_CURRENT_DATA || video.videoWidth === 0) {
        scanTimerRef.current = setTimeout(tick, SCAN_INTERVAL_MS);
        return;
      }
      try {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          scanTimerRef.current = setTimeout(tick, SCAN_INTERVAL_MS);
          return;
        }
        const maxDim = 480;
        const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "attemptBoth",
        });
        if (decoded && decoded.payload) {
          const conn = parseConnectionFromText(decoded.payload);
          if (conn) {
            detectedRef.current = true;
            void onDetected(conn);
            return;
          }
        }
      } catch (err) {
        console.warn("[scan] decode error", err);
      }
      scanTimerRef.current = setTimeout(tick, SCAN_INTERVAL_MS);
    }

    void start();
    return () => {
      cancelled = true;
      if (scanTimerRef.current !== null) clearTimeout(scanTimerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [onDetected, t]);

  if (error) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={onSwitchToManual}>
          {t("mobile-connect.manual")}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          {t("mobile-connect.back")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-md border border-border bg-muted">
        <video
          ref={videoRef}
          className="absolute inset-0 size-full object-cover"
          muted
          playsInline
        />
        <canvas ref={canvasRef} className="hidden" />
      </div>
      <p className="text-center text-sm text-muted-foreground">
        {t("mobile-connect.scanHint")}
      </p>
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeftIcon className="size-4" />
        {t("mobile-connect.back")}
      </Button>
    </div>
  );
}

function ManualPanel({
  submitting,
  onBack,
  onSubmit,
}: {
  submitting: boolean;
  onBack: () => void;
  onSubmit: (conn: ParsedConnection) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");

  const canSubmit = baseUrl.trim() !== "" && token.trim() !== "" && !submitting;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    void onSubmit({ baseUrl: baseUrl.trim(), token: token.trim() });
  };

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <Field>
        <FieldLabel>{t("mobile-connect.baseUrl")}</FieldLabel>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://example.trycloudflare.com"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </Field>
      <Field>
        <FieldLabel>{t("mobile-connect.token")}</FieldLabel>
        <Input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          type="text"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </Field>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onBack} disabled={submitting}>
          <ArrowLeftIcon className="size-4" />
          {t("mobile-connect.back")}
        </Button>
        <Button type="submit" disabled={!canSubmit} className="flex-1">
          {t("mobile-connect.connect")}
        </Button>
      </div>
    </form>
  );
}
