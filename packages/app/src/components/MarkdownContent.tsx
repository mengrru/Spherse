import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MarkdownContentProps {
  children: string;
  variant?: "chat" | "document";
}

export function MarkdownContent({ children, variant = "document" }: MarkdownContentProps) {
  const compact = variant === "chat";
  const components: Components = {
    h1: ({ className, ...props }) => (
      <h1 className={cn(compact ? "mt-2 mb-1 text-base" : "mt-6 mb-3 text-2xl", "font-semibold tracking-normal", className)} {...props} />
    ),
    h2: ({ className, ...props }) => (
      <h2 className={cn(compact ? "mt-2 mb-1 text-sm" : "mt-5 mb-2 text-xl", "font-semibold tracking-normal", className)} {...props} />
    ),
    h3: ({ className, ...props }) => (
      <h3 className={cn(compact ? "mt-2 mb-1 text-sm" : "mt-4 mb-2 text-lg", "font-medium tracking-normal", className)} {...props} />
    ),
    p: ({ className, ...props }) => (
      <p className={cn(compact ? "mb-2 last:mb-0" : "mb-3 last:mb-0", className)} {...props} />
    ),
    ul: ({ className, ...props }) => (
      <ul className={cn(compact ? "mb-2 pl-5" : "mb-3 pl-6", "list-disc", className)} {...props} />
    ),
    ol: ({ className, ...props }) => (
      <ol className={cn(compact ? "mb-2 pl-5" : "mb-3 pl-6", "list-decimal", className)} {...props} />
    ),
    li: ({ className, ...props }) => (
      <li className={cn("mb-1", className)} {...props} />
    ),
    code: ({ className, ...props }) => (
      <code className={cn("rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]", className)} {...props} />
    ),
    pre: ({ className, ...props }) => (
      <pre className={cn(compact ? "mb-2 p-2" : "mb-3 p-3", "overflow-x-auto rounded-md bg-muted font-mono text-xs", className)} {...props} />
    ),
    blockquote: ({ className, ...props }) => (
      <blockquote className={cn("mb-3 border-l-2 border-border pl-3 text-muted-foreground", className)} {...props} />
    ),
    table: ({ className, ...props }) => (
      <div className="mb-3 overflow-x-auto">
        <table className={cn("w-full border-collapse text-left text-xs", className)} {...props} />
      </div>
    ),
    th: ({ className, ...props }) => (
      <th className={cn("border border-border bg-muted px-2 py-1 font-medium", className)} {...props} />
    ),
    td: ({ className, ...props }) => (
      <td className={cn("border border-border px-2 py-1 align-top", className)} {...props} />
    ),
    a: ({ className, ...props }) => (
      <a className={cn("text-primary underline underline-offset-4", className)} {...props} />
    ),
  };

  return (
    <div className={cn(compact ? "text-sm leading-6" : "text-sm leading-7")}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </Markdown>
    </div>
  );
}
