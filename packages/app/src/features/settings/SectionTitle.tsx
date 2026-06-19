import type { ComponentProps, ElementType } from "react";
import { cn } from "../../lib/utils";

export function SectionTitle({
  as: Component = "div",
  className,
  ...props
}: ComponentProps<"div"> & {
  as?: ElementType;
}) {
  return (
    <Component
      className={cn("mb-2 text-sm font-medium leading-none", className)}
      {...props}
    />
  );
}
