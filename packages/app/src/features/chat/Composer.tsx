import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { ChevronsDownIcon, ChevronsUpIcon, ImageIcon, Loader2Icon, SendIcon, SquareIcon } from "lucide-react";
import type { AttachedImage } from "./types";
import { compressImage } from "./utils/compress-image";
import { AttachmentBar, type AttachStatus } from "./AttachmentBar";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient } from "../../lib/use-connection";

const LINE_HEIGHT = 20;
const PADDING_Y = 16;
const MIN_HEIGHT = 2 * LINE_HEIGHT + PADDING_Y;
const MID_HEIGHT = 10 * LINE_HEIGHT + PADDING_Y;
const MAX_HEIGHT = 20 * LINE_HEIGHT + PADDING_Y;

interface ComposerProps {
  streaming: boolean;
  loading?: boolean;
  sessionId: string;
  onSend: (message: string, image?: AttachedImage) => boolean;
  onAbort: () => void;
}

export function Composer({ streaming, loading = false, sessionId, onSend, onAbort }: ComposerProps) {
  const { t } = useI18n();
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);
  const draftKey = `spherse:draft:${sessionId}`;
  const [input, setInput] = useState(() => localStorage.getItem(draftKey) ?? "");
  const [manualExpanded, setManualExpanded] = useState(false);
  const [contentExceeds3Lines, setContentExceeds3Lines] = useState(false);
  const [image, setImage] = useState<AttachedImage | null>(null);
  const [attachStatus, setAttachStatus] = useState<AttachStatus>("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  });

  const attachBusy = attachStatus === "compressing" || attachStatus === "uploading";

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const prevScrollTop = textarea.scrollTop;
    textarea.style.height = "auto"; // collapse to measure scrollHeight
    const natural = textarea.scrollHeight;
    const exceeds = natural > MIN_HEIGHT + 4;
    setContentExceeds3Lines(exceeds);
    if (!exceeds && manualExpanded) {
      setManualExpanded(false);
      return;
    }
    if (manualExpanded) {
      textarea.style.height = `${MAX_HEIGHT}px`;
      textarea.style.overflowY = natural > MAX_HEIGHT ? "auto" : "hidden";
    } else {
      const targetHeight = Math.max(MIN_HEIGHT, Math.min(natural, MID_HEIGHT));
      textarea.style.height = `${targetHeight}px`;
      textarea.style.overflowY = natural > MID_HEIGHT ? "auto" : "hidden";
    }
    textarea.scrollTop = prevScrollTop; // prevent scroll-to-top after height change
  }, [input, manualExpanded]);

  useEffect(() => {
    if (input) {
      const timer = setTimeout(() => localStorage.setItem(draftKey, input), 300);
      return () => clearTimeout(timer);
    }
    localStorage.removeItem(draftKey);
  }, [input, draftKey]);

  useEffect(() => {
    return () => {
      if (inputRef.current) {
        localStorage.setItem(`spherse:draft:${sessionId}`, inputRef.current);
      }
    };
  }, [sessionId]);

  const send = () => {
    const message = input.trim();
    if (!message || streaming || loading || attachBusy) return;
    const sent = onSend(message, image ?? undefined);
    if (!sent) return;
    setInput("");
    setImage(null);
    setAttachStatus("idle");
    localStorage.removeItem(draftKey);
    setManualExpanded(false);
  };

  const handleAttachClick = () => {
    if (attachBusy) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !client) return;
    setAttachStatus("compressing");
    try {
      const { blob, width, height } = await compressImage(file);
      setAttachStatus("uploading");
      const res = await client.uploadAttachedImage(blob, { width, height });
      setImage({
        path: res.path,
        mimeType: "image/jpeg",
        width,
        height,
        previewUrl: client.getPreviewUrl(res.path),
      });
      setAttachStatus("idle");
    } catch (err) {
      setAttachStatus("error");
      toast.error(t("chat.imageAttachFailed", { message: (err as Error).message }));
    }
  };

  const handleRemoveImage = () => {
    const path = image?.path;
    setImage(null);
    setAttachStatus("idle");
    if (path && client) {
      void client.deleteAttachment(path).catch(() => {});
    }
  };

  useEffect(() => {
    if (!streaming && !loading) textareaRef.current?.focus();
  }, [streaming, loading]);

  return (
    <div className="border-t border-border bg-background p-3" data-chat-composer>
      {(image || attachBusy) && (
        <AttachmentBar image={image} status={attachStatus} onRemove={handleRemoveImage} />
      )}
      <div className="relative rounded-lg border border-input bg-background transition-colors focus-within:border-ring" data-chat-composer-input>
        <Textarea
          ref={textareaRef}
          className="min-h-0 w-full resize-none border-none bg-transparent py-2 ps-3 pe-8 text-sm md:text-sm leading-5 shadow-none focus-visible:ring-0"
          style={{ height: `${MIN_HEIGHT}px`, overflowY: "hidden" }}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          placeholder={t("chat.composerPlaceholder")}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              !composingRef.current
            ) {
              event.preventDefault();
              send();
            }
          }}
          disabled={loading}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
        {contentExceeds3Lines && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="absolute top-1.5 end-2.5"
            onClick={() => setManualExpanded((value) => !value)}
            title={manualExpanded ? t("chat.collapse") : t("chat.expand")}
          >
            {manualExpanded ? <ChevronsDownIcon /> : <ChevronsUpIcon />}
          </Button>
        )}
        <div className="flex items-center justify-between px-2 pb-2 pt-0.5">
          <Button
            variant="ghost"
            size="icon"
            disabled={attachBusy}
            onClick={handleAttachClick}
            title={t("chat.attachImage")}
          >
            {attachBusy ? <Loader2Icon className="animate-spin" /> : <ImageIcon />}
          </Button>
          {streaming ? (
            <Button variant="destructive" size="icon-lg" onClick={onAbort}>
              <SquareIcon />
            </Button>
          ) : (
            <Button
              size="icon-lg"
              onClick={send}
              disabled={!input.trim() || attachBusy}
            >
              <SendIcon />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
