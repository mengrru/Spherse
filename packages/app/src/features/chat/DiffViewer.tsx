import { useMemo } from "react"
import { useI18n } from "@spherse/i18n/react"
import { computeLineDiff } from "./lib/compute-diff"

interface DiffViewerProps {
  oldString: string
  newString: string
}

export function DiffViewer({ oldString, newString }: DiffViewerProps) {
  const { t } = useI18n()
  const { left, right } = useMemo(
    () => computeLineDiff(oldString, newString),
    [oldString, newString],
  )

  const lineBase = "w-full px-2 whitespace-pre"

  return (
    <div className="my-1 grid grid-cols-2 gap-2">
      <div className="min-w-0">
        <div className="mb-0.5 text-xs text-muted-foreground">
          {t("viewer-card.old")}
        </div>
        <pre className="max-h-[400px] overflow-auto font-mono text-xs">
          <div className="inline-block min-w-full">
            {left.map((line, i) => (
              <div
                key={i}
                className={
                  line.type === "removed"
                    ? `${lineBase} bg-destructive/10`
                    : lineBase
                }
              >
                {line.text || "\u00A0"}
              </div>
            ))}
          </div>
        </pre>
      </div>
      <div className="min-w-0">
        <div className="mb-0.5 text-xs text-muted-foreground">
          {t("viewer-card.new")}
        </div>
        <pre className="max-h-[400px] overflow-auto font-mono text-xs">
          <div className="inline-block min-w-full">
            {right.map((line, i) => (
              <div
                key={i}
                className={
                  line.type === "added"
                    ? `${lineBase} bg-agent-diff-added/10`
                    : lineBase
                }
              >
                {line.text || "\u00A0"}
              </div>
            ))}
          </div>
        </pre>
      </div>
    </div>
  )
}
