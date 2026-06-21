import { useState } from "react"
import { useI18n } from "@spherse/i18n/react"
import type { FileChangeCard, FileChangeOp } from "./types"
import { DiffViewer } from "./DiffViewer"
import { Badge } from "../../components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible"
import { ChevronRightIcon } from "lucide-react"

interface FileViewerCardProps {
  change: FileChangeCard
  onNavigateToPath?: (path: string) => void
}

function OpSubSection({ op }: { op: FileChangeOp }) {
  const { t } = useI18n()
  const args = op.args
  const isWrite = op.toolName === "write_file"

  return (
    <div className="border-t border-border">
      <div className="flex items-center gap-2 bg-muted/50 px-3 py-1.5">
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          {op.toolName}
        </span>
        <span className="text-xs text-muted-foreground">
          {isWrite
            ? t("viewer-card.bytes", { n: String(args.content ?? "").length })
            : t("viewer-card.occurrence", { n: 1 })}
        </span>
      </div>
      {isWrite ? (
        args.content ? (
          <pre className="max-h-[400px] overflow-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-xs">
            {String(args.content)}
          </pre>
        ) : (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            {t("viewer-card.emptyContent")}
          </div>
        )
      ) : (
        <div className="px-3 py-2">
          <DiffViewer
            oldString={String(args.old_string ?? "")}
            newString={String(args.new_string ?? "")}
          />
        </div>
      )}
    </div>
  )
}

export function FileViewerCard({
  change,
  onNavigateToPath,
}: FileViewerCardProps) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)

  const isCreated = change.ops.every((op) => op.toolName === "write_file")
  const statusKey = isCreated ? "viewer-card.created" : "viewer-card.modified"
  const statusClass = isCreated
    ? "border-transparent bg-agent-diff-added/20 text-agent-diff-added"
    : "border-transparent bg-accent text-accent-foreground"

  const pathNode = onNavigateToPath ? (
    <button
      type="button"
      onClick={() => onNavigateToPath(change.path)}
      className="font-mono text-xs text-primary underline hover:opacity-80"
    >
      {change.path}
    </button>
  ) : (
    <span className="font-mono text-xs text-primary underline">
      {change.path}
    </span>
  )

  return (
    <Collapsible open={expanded} className="mb-2">
      <div
        className={`flex items-center gap-1 bg-card px-2 py-1.5 ${
          expanded ? "rounded-t-lg border border-b-0 border-border" : "rounded-lg border border-border"
        }`}
      >
        <CollapsibleTrigger
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex size-4 items-center justify-center text-muted-foreground transition-transform"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          <ChevronRightIcon className="size-3.5" />
        </CollapsibleTrigger>
        <Badge variant="outline" className={statusClass}>
          {t(statusKey)}
        </Badge>
        {pathNode}
        {change.ops.length > 1 && (
          <span className="text-xs text-muted-foreground">
            {t("viewer-card.changeCount", { n: change.ops.length })}
          </span>
        )}
      </div>
      <CollapsibleContent>
        <div className="overflow-hidden rounded-b-lg border-x border-b border-border">
          <div className="max-h-[600px] overflow-auto">
            {change.ops.map((op) => (
              <OpSubSection key={op.toolCallId} op={op} />
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
