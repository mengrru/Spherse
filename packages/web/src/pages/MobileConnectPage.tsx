import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { toast } from "sonner";
import jsQR from "jsqr";
import { ArrowLeftIcon, CameraIcon, ImageIcon, KeyboardIcon, Loader2Icon, LogOutIcon } from "lucide-react";
import { Button } from "@spherse/app/ui/button";
import { Input } from "@spherse/app/ui/input";
import { Field, FieldLabel } from "@spherse/app/ui/field";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@spherse/app/ui/alert-dialog";
import { parseConnectPayload, type ConnectPayload } from "@spherse/app/connect-payload";
import { useHostBridge } from "@spherse/app/host-bridge-context";
import { useAppStore } from "@spherse/app/stores/app";
import { useBusStore } from "@spherse/app/stores/bus";
import { runWebVersionGuard } from "../version-guard";
import { readWebConnection, WEB_CONNECTION_STORAGE_KEY } from "../host-bridge-web";

const SCAN_FALLBACK_INTERVAL_MS = 300;
const VIDEO_MAX_DIM = 960;

type Mode = "menu" | "scan" | "manual";

function persistConnection(conn: ConnectPayload): void {
  localStorage.setItem(
    WEB_CONNECTION_STORAGE_KEY,
    JSON.stringify({ baseUrl: conn.baseUrl.replace(/\/+$/, ""), token: conn.token }),
  );
}

interface QrDetector {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
}

let cachedDetector: QrDetector | null | undefined;

function getQrDetector(): QrDetector | null {
  if (cachedDetector === undefined) {
    const Ctor = (window as unknown as {
      BarcodeDetector?: new (opts: { formats: string[] }) => QrDetector;
    }).BarcodeDetector;
    if (typeof Ctor === "function") {
      try {
        cachedDetector = new Ctor({ formats: ["qr_code"] });
      } catch {
        cachedDetector = null;
      }
    } else {
      cachedDetector = null;
    }
  }
  return cachedDetector;
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

function drawScaled(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxDim: number,
  reuse?: HTMLCanvasElement,
): { canvas: HTMLCanvasElement; imageData: ImageData } | null {
  const canvas = reuse ?? document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const scale = Math.min(1, maxDim / Math.max(sourceWidth, sourceHeight));
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { canvas, imageData };
}

function jsQrFromImageData(imageData: ImageData): string | null {
  const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "attemptBoth",
  });
  return decoded?.data ?? null;
}

async function detectWithDetector(detector: QrDetector, source: CanvasImageSource): Promise<string | null> {
  try {
    const results = await detector.detect(source);
    const raw = results.find((r) => typeof r.rawValue === "string" && r.rawValue);
    return raw?.rawValue ?? null;
  } catch {
    return null;
  }
}

async function decodeImageFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const detector = getQrDetector();
    const attempts = [VIDEO_MAX_DIM, Math.max(bitmap.width, bitmap.height)];
    for (const maxDim of attempts) {
      const drawn = drawScaled(bitmap, bitmap.width, bitmap.height, maxDim);
      if (!drawn) break;
      if (detector) {
        const payload = await detectWithDetector(detector, drawn.canvas);
        if (payload) return payload;
      }
      const decoded = jsQrFromImageData(drawn.imageData);
      if (decoded) return decoded;
    }
    return null;
  } finally {
    bitmap.close();
  }
}

export function MobileConnectPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const bridge = useHostBridge();
  const restoreProjects = useAppStore((state) => state.restoreProjects);
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>("menu");
  const [submitting, setSubmitting] = useState(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [hasSavedConnection] = useState(() => Boolean(readWebConnection()?.baseUrl));

  const handleDisconnect = () => {
    localStorage.removeItem(WEB_CONNECTION_STORAGE_KEY);
    window.location.reload();
  };

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
          <Button variant="outline" className="w-full justify-start gap-2" onClick={() => setMode("scan")}>
            <CameraIcon className="size-4" />
            {t("mobile-connect.scan")}
          </Button>
          <Button variant="outline" className="w-full justify-start gap-2" onClick={() => setMode("manual")}>
            <KeyboardIcon className="size-4" />
            {t("mobile-connect.manual")}
          </Button>
          {hasSavedConnection && (
            <>
              <Button
                variant="ghost"
                className="mt-4 w-full justify-start gap-2 text-muted-foreground"
                onClick={() => setDisconnectConfirmOpen(true)}
              >
                <LogOutIcon className="size-4" />
                {t("mobile-connect.disconnect")}
              </Button>
              <AlertDialog open={disconnectConfirmOpen} onOpenChange={setDisconnectConfirmOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("mobile-connect.disconnectTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("mobile-connect.disconnectDescription")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDisconnect}>
                      {t("mobile-connect.disconnect")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      ) : mode === "scan" ? (
        <ScanPanel
          onDetected={(conn) => handleConnect(conn, conn.targetPath)}
          onSwitchToManual={() => setMode("manual")}
          onBack={() => setMode("menu")}
        />
      ) : (
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
  onDetected,
  onSwitchToManual,
  onBack,
}: {
  onDetected: (conn: ConnectPayload) => void | Promise<void>;
  onSwitchToManual: () => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rvfcHandleRef = useRef<number | null>(null);
  const detectedRef = useRef(false);
  const decodingRef = useRef(false);
  const [error, setError] = useState<"denied" | "unavailable" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const onDetectedRef = useRef(onDetected);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  });

  useEffect(() => {
    let cancelled = false;
    const mountedVideo = videoRef.current as FrameCallbackVideo | null;

    function scheduleNext(): void {
      if (cancelled || detectedRef.current) return;
      const video = videoRef.current as FrameCallbackVideo | null;
      if (video && typeof video.requestVideoFrameCallback === "function") {
        rvfcHandleRef.current = video.requestVideoFrameCallback(() => {
          rvfcHandleRef.current = null;
          void tick();
        });
      } else {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          void tick();
        }, SCAN_FALLBACK_INTERVAL_MS);
      }
    }

    async function tick(): Promise<void> {
      if (cancelled || detectedRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || decodingRef.current) {
        scheduleNext();
        return;
      }
      if (video.readyState < video.HAVE_CURRENT_DATA || video.videoWidth === 0) {
        scheduleNext();
        return;
      }
      decodingRef.current = true;
      try {
        const detector = getQrDetector();
        let payload: string | null = null;
        if (detector) {
          payload = await detectWithDetector(detector, video);
        }
        if (!payload) {
          const drawn = drawScaled(video, video.videoWidth, video.videoHeight, VIDEO_MAX_DIM, canvas);
          payload = drawn ? jsQrFromImageData(drawn.imageData) : null;
        }
        if (payload) {
          const conn = parseConnectPayload(payload);
          if (conn) {
            if (detectedRef.current) return;
            detectedRef.current = true;
            void onDetectedRef.current(conn);
            return;
          }
          setNotice(t("mobile-connect.invalidQr"));
        }
      } catch (err) {
        console.debug("[scan] decode error", err);
      } finally {
        decodingRef.current = false;
      }
      scheduleNext();
    }

    async function start(): Promise<void> {
      if (!("mediaDevices" in navigator) || !navigator.mediaDevices?.getUserMedia) {
        setError("unavailable");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.muted = true;
          video.srcObject = stream;
          try {
            await video.play();
          } catch (err) {
            console.warn("[scan] video.play() rejected", err);
          }
        }
        scheduleNext();
      } catch (err) {
        const name = (err as DOMException)?.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          setError("denied");
        } else {
          setError("unavailable");
        }
      }
    }

    void start();
    return () => {
      cancelled = true;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const video = mountedVideo;
      if (video && rvfcHandleRef.current !== null && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(rvfcHandleRef.current);
      }
      rvfcHandleRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [t]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const payload = await decodeImageFile(file);
      const conn = payload ? parseConnectPayload(payload) : null;
      if (conn) {
        if (detectedRef.current) return;
        detectedRef.current = true;
        void onDetectedRef.current(conn);
      } else {
        toast.error(t("mobile-connect.invalidQr"));
      }
    } catch (err) {
      console.debug("[scan] image decode error", err);
      toast.error(t("mobile-connect.invalidQr"));
    }
  };

  if (error) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-3">
        <p className="text-sm text-destructive">
          {t(error === "denied" ? "mobile-connect.cameraDenied" : "mobile-connect.scanUnavailable")}
        </p>
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={() => fileInputRef.current?.click()}
        >
          <ImageIcon className="size-4" />
          {t("mobile-connect.decodeFromImage")}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
        <Button variant="outline" className="w-full justify-start gap-2" onClick={onSwitchToManual}>
          <KeyboardIcon className="size-4" />
          {t("mobile-connect.manual")}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeftIcon className="size-4" />
          {t("mobile-connect.back")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-md border border-border bg-muted">
        <video ref={videoRef} className="absolute inset-0 size-full object-cover" muted playsInline />
        <canvas ref={canvasRef} className="hidden" />
      </div>
      <p className="text-center text-sm text-muted-foreground">{t("mobile-connect.scanHint")}</p>
      {notice && <p className="text-center text-xs text-muted-foreground">{notice}</p>}
      <Button
        variant="outline"
        className="w-full justify-start gap-2"
        onClick={() => fileInputRef.current?.click()}
      >
        <ImageIcon className="size-4" />
        {t("mobile-connect.decodeFromImage")}
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
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
  onSubmit: (conn: ConnectPayload) => void | Promise<void>;
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
          {submitting ? t("common.loading") : t("mobile-connect.connect")}
        </Button>
      </div>
    </form>
  );
}
