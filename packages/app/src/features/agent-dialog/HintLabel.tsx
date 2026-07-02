import { InfoIcon } from "lucide-react";
import { FieldLabel } from "../../components/ui/field";
import { Tooltip, TooltipTrigger, TooltipContent } from "../../components/ui/tooltip";

export function HintLabel({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint: string;
}) {
  return (
    <FieldLabel>
      {children}
      <Tooltip>
        <TooltipTrigger aria-label={hint} className="inline-flex cursor-help text-muted-foreground">
          <InfoIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent>{hint}</TooltipContent>
      </Tooltip>
    </FieldLabel>
  );
}
