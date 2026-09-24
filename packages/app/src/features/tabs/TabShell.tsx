import { useEffect, useRef, type DragEvent, type ReactNode } from "react";
import { XIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { cn } from "../../lib/utils";

export interface TabDragProps {
  draggable: boolean;
  dropTarget: boolean;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

interface TabShellProps {
  tabKey: string;
  kind: string;
  icon: ReactNode;
  label: string;
  title?: string;
  active: boolean;
  onSelect: () => void;
  onClose?: () => void;
  drag?: TabDragProps;
}

export function TabShell({ tabKey, kind, icon, label, title, active, onSelect, onClose, drag }: TabShellProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <div
      ref={ref}
      data-tab={kind}
      data-tab-key={tabKey}
      data-active={active ? "true" : undefined}
      className={cn(
        "group/tab relative flex min-w-0 max-w-52 shrink-0 items-center border-e border-border",
        active
          ? "bg-background text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        drag?.dropTarget && "before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-primary",
      )}
      draggable={drag?.draggable ?? false}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDragLeave={drag?.onDragLeave}
      onDrop={drag?.onDrop}
      onDragEnd={drag?.onDragEnd}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-1.5 ps-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
          onClose ? "pe-1" : "pe-3",
        )}
        title={title ?? label}
        onClick={onSelect}
      >
        <span className="flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3.5">{icon}</span>
        <span className="truncate">{label}</span>
      </button>
      {onClose && (
        <button
          type="button"
          className={cn(
            "me-1 flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-muted-foreground/15 focus-visible:opacity-100",
            active ? "opacity-70" : "opacity-0 group-hover/tab:opacity-70",
            "[@media(hover:none)]:opacity-70",
          )}
          aria-label={t("tabs.close", { name: label })}
          title={t("tabs.close", { name: label })}
          onClick={onClose}
        >
          <XIcon className="size-3" />
        </button>
      )}
    </div>
  );
}
