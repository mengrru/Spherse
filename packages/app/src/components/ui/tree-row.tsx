import type { ComponentProps } from "react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

interface TreeRowProps extends ComponentProps<typeof Button> {
  depth: number;
  selected?: boolean;
}

function TreeRow({ depth, selected, className, style, ...props }: TreeRowProps) {
  return (
    <Button
      variant="ghost"
      size="default"
      className={cn(
        "w-full justify-start gap-2",
        selected
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        className,
      )}
      style={{ ...style, paddingLeft: depth * 16 + 8 }}
      {...props}
    />
  );
}

export { TreeRow };
