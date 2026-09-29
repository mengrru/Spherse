import { useEffect, useRef, useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import { toast } from "sonner";
import { ArrowLeftIcon, ImageIcon, KeyboardIcon } from "lucide-react";
import { Button } from "@spherse/app/ui/button";
import { parseConnectPayload, type ConnectPayload } from "@spherse/app/connect-payload";
import {
  SCAN_FALLBACK_INTERVAL_MS,
  VIDEO_MAX_DIM,
  decodeImageFile,
  detectWithDetector,
  drawScaled,
  getQrDetector,
  jsQrFromImageData,
  type FrameCallbackVideo,
} from "./qr-decode";

export function ScanPanel({
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
