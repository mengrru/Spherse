import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "../../components/ui/button";
import { XIcon, PauseIcon, PlayIcon, TrashIcon, ArrowDownIcon } from "lucide-react";

const MAX_LOG_LINES = 1000;

const LEVEL_COLORS: Record<number, string> = {
  10: "text-muted-foreground",
  20: "text-blue-400",
  30: "text-green-400",
  40: "text-yellow-400",
  50: "text-red-400",
  60: "text-red-600",
};

const LEVEL_LABELS: Record<number, string> = {
  10: "TRACE",
  20: "DEBUG",
  30: "INFO ",
  40: "WARN ",
  50: "ERROR",
  60: "FATAL",
};

interface LogEntry {
  time: number;
  level: number;
  msg: string;
  [key: string]: unknown;
}

interface LogPanelProps {
  baseUrl: string;
  onClose: () => void;
}

export function LogPanel({ baseUrl, onClose }: LogPanelProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pausedRef = useRef(false);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    autoScrollRef.current = autoScroll;
  }, [autoScroll]);

  useEffect(() => {
    const wsUrl = `${baseUrl.replace(/^http/, "ws")}/ws/debug`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      if (pausedRef.current) return;
      try {
        const entry = JSON.parse(event.data) as LogEntry;
        setLogs((prev) => {
          const next = [...prev, entry];
          return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
        });
      } catch {
        setLogs((prev) => {
          const entry: LogEntry = { time: Date.now(), level: 30, msg: event.data };
          const next = [...prev, entry];
          return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
        });
      }
    };

    ws.onerror = () => {};

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [baseUrl]);

  useEffect(() => {
    if (!autoScrollRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    if (atBottom !== autoScrollRef.current) {
      setAutoScroll(atBottom);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setAutoScroll(true);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  return (
    <DraggableWindow onClose={onClose} title="Streaming Log">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setPaused(!paused)}
          title={paused ? "Resume" : "Pause"}
        >
          {paused ? <PlayIcon className="h-3 w-3" /> : <PauseIcon className="h-3 w-3" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={clearLogs}
          title="Clear"
        >
          <TrashIcon className="h-3 w-3" />
        </Button>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">
          {logs.length} lines{paused ? " (paused)" : ""}
        </span>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto bg-muted/50 font-mono text-xs leading-5 p-2"
      >
        {logs.map((entry, i) => (
          <LogLine key={i} entry={entry} />
        ))}
      </div>
      {!autoScroll && (
        <Button
          variant="secondary"
          size="sm"
          className="absolute bottom-2 right-2 h-6 text-xs"
          onClick={scrollToBottom}
        >
          <ArrowDownIcon className="h-3 w-3 mr-1" />
          Scroll to bottom
        </Button>
      )}
    </DraggableWindow>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  const time = new Date(entry.time).toLocaleTimeString("en-US", { hour12: false });
  const level = entry.level ?? 30;
  const color = LEVEL_COLORS[level] ?? "text-foreground";
  const label = LEVEL_LABELS[level] ?? "-----";

  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry)) {
    if (k !== "time" && k !== "level" && k !== "msg") {
      rest[k] = v;
    }
  }
  const restStr = Object.keys(rest).length > 0 ? " " + JSON.stringify(rest) : "";

  return (
    <div className={color}>
      <span className="text-muted-foreground">{time}</span>{" "}
      <span>[{label}]</span>{" "}
      <span>{entry.msg}</span>
      <span className="text-muted-foreground">{restStr}</span>
    </div>
  );
}

function DraggableWindow({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  const [position, setPosition] = useState({ x: window.innerWidth - 520, y: window.innerHeight - 380 });
  const [size] = useState({ w: 500, h: 360 });
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPosition({
        x: dragRef.current.startPosX + dx,
        y: dragRef.current.startPosY + dy,
      });
    };
    const handleMouseUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x,
      startPosY: position.y,
    };
  };

  return (
    <div
      className="fixed z-50 flex flex-col bg-card border border-border rounded-lg shadow-lg overflow-hidden"
      style={{
        left: position.x,
        top: position.y,
        width: size.w,
        height: size.h,
      }}
    >
      <div
        className="flex items-center px-3 py-1.5 border-b border-border cursor-move select-none bg-muted/30"
        onMouseDown={handleMouseDown}
      >
        <span className="text-xs font-medium">{title}</span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="h-5 w-5 inline-flex items-center justify-center rounded-sm hover:bg-muted-foreground/10"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      {children}
    </div>
  );
}
