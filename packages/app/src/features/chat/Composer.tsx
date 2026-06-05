import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { ChevronsDownIcon, ChevronsUpIcon, SendIcon, SquareIcon } from "lucide-react";

const LINE_HEIGHT = 20;
const PADDING_Y = 16;
const MIN_HEIGHT = 4 * LINE_HEIGHT + PADDING_Y;
const MID_HEIGHT = 10 * LINE_HEIGHT + PADDING_Y;
const MAX_HEIGHT = 20 * LINE_HEIGHT + PADDING_Y;

interface ComposerProps {
  streaming: boolean;
  sessionId: string;
  onSend: (message: string) => void;
  onAbort: () => void;
}

export function Composer({ streaming, sessionId, onSend, onAbort }: ComposerProps) {
  const draftKey = `spherse:draft:${sessionId}`;
  const [input, setInput] = useState(() => localStorage.getItem(draftKey) ?? "");
  const [manualExpanded, setManualExpanded] = useState(false);
  const [contentExceeds3Lines, setContentExceeds3Lines] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef(input);
  inputRef.current = input;

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
    if (!message || streaming) return;
    onSend(message);
    setInput("");
    localStorage.removeItem(draftKey);
    setManualExpanded(false);
  };

  useEffect(() => {
    if (!streaming) textareaRef.current?.focus();
  }, [streaming]);

  return (
    <div className="border-t border-border bg-background p-3">
      <div className="relative rounded-lg border border-input bg-background transition-colors focus-within:border-ring">
        <Textarea
          ref={textareaRef}
          className="min-h-0 w-full resize-none border-none bg-transparent py-2 pr-12 pl-3 text-sm leading-5 shadow-none focus-visible:ring-0"
          style={{ height: `${MIN_HEIGHT}px`, overflowY: "hidden" }}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="输入消息... (Shift+Enter 换行)"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          disabled={streaming}
        />
        {contentExceeds3Lines && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="absolute top-1.5 right-2.5"
            onClick={() => setManualExpanded((value) => !value)}
            title={manualExpanded ? "收起" : "展开"}
          >
            {manualExpanded ? <ChevronsDownIcon /> : <ChevronsUpIcon />}
          </Button>
        )}
        <div className="absolute bottom-2 right-2">
          {streaming ? (
            <Button variant="destructive" size="icon-lg" onClick={onAbort}>
              <SquareIcon />
            </Button>
          ) : (
            <Button
              size="icon-lg"
              onClick={send}
              disabled={!input.trim()}
            >
              <SendIcon />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
