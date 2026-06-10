import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { Button } from "../../components/ui/button";
import { ChevronRightIcon, AlertTriangleIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";

interface ErrorMessageSectionProps {
  error: string;
}

export function ErrorMessageSection({ error }: ErrorMessageSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useI18n();

  return (
    <div className="mt-2 border-t border-dashed border-border pt-2">
      <Collapsible open={expanded}>
        <CollapsibleTrigger
          render={<Button variant="ghost" className="-mx-1 h-auto w-full justify-start gap-1 px-1 py-1 pe-3 text-xs text-destructive hover:text-destructive" />}
          onClick={() => setExpanded((v) => !v)}
        >
          <span
            className="inline-flex size-3 items-center justify-center transition-transform"
            style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            <ChevronRightIcon className="size-3" />
          </span>
          <AlertTriangleIcon className="size-3" />
          {t("chat.responseGenerationFailed")}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="ml-4 mt-0.5 mb-1.5 text-xs text-destructive break-all">
            {error}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
