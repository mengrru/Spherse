import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MarkdownContentProps {
  children: string;
  variant?: "chat" | "document";
}

const DOCUMENT_COMPONENTS: Components = {
  h1: ({ className, ...props }) => (
    <h1 className={cn("mt-6 mb-3 text-2xl font-semibold tracking-normal", className)} {...props} />
  ),
  h2: ({ className, ...props }) => (
    <h2 className={cn("mt-5 mb-2 text-xl font-semibold tracking-normal", className)} {...props} />
  ),
  h3: ({ className, ...props }) => (
    <h3 className={cn("mt-4 mb-2 text-lg font-medium tracking-normal", className)} {...props} />
  ),
  p: ({ className, ...props }) => (
    <p className={cn("mb-3 last:mb-0", className)} {...props} />
  ),
  ul: ({ className, ...props }) => (
    <ul className={cn("mb-3 pl-6 list-disc", className)} {...props} />
  ),
  ol: ({ className, ...props }) => (
    <ol className={cn("mb-3 pl-6 list-decimal", className)} {...props} />
  ),
  li: ({ className, ...props }) => (
    <li className={cn("mb-1", className)} {...props} />
  ),
  code: ({ className, ...props }) => (
    <code className={cn("rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]", className)} {...props} />
  ),
  pre: ({ className, ...props }) => (
    <pre className={cn("mb-3 p-3 overflow-x-auto rounded-md bg-muted font-mono text-xs", className)} {...props} />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote className={cn("mb-3 rounded-r border-l-4 border-border bg-muted/50 pl-3 text-foreground/80 text-[13px] italic", className)} {...props} />
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

const CHAT_COMPONENTS: Components = {
  h1: ({ className, ...props }) => (
    <h1 className={cn("mt-2 mb-1 text-base font-semibold tracking-normal", className)} {...props} />
  ),
  h2: ({ className, ...props }) => (
    <h2 className={cn("mt-2 mb-1 text-sm font-semibold tracking-normal", className)} {...props} />
  ),
  h3: ({ className, ...props }) => (
    <h3 className={cn("mt-2 mb-1 text-sm font-medium tracking-normal", className)} {...props} />
  ),
  p: ({ className, ...props }) => (
    <p className={cn("mb-2 last:mb-0", className)} {...props} />
  ),
  ul: ({ className, ...props }) => (
    <ul className={cn("mb-2 pl-5 list-disc", className)} {...props} />
  ),
  ol: ({ className, ...props }) => (
    <ol className={cn("mb-2 pl-5 list-decimal", className)} {...props} />
  ),
  li: ({ className, ...props }) => (
    <li className={cn("mb-1", className)} {...props} />
  ),
  code: ({ className, ...props }) => (
    <code className={cn("rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]", className)} {...props} />
  ),
  pre: ({ className, ...props }) => (
    <pre className={cn("mb-2 p-2 overflow-x-auto rounded-md bg-muted font-mono text-xs", className)} {...props} />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote className={cn("mb-3 rounded-r border-l-4 border-border bg-muted/50 pl-3 text-foreground/80 text-[13px] italic", className)} {...props} />
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

export function MarkdownContent({ children, variant = "document" }: MarkdownContentProps) {
  const components = variant === "chat" ? CHAT_COMPONENTS : DOCUMENT_COMPONENTS;

  return (
    <div className={variant === "chat" ? "text-sm leading-6" : "text-sm leading-7"}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </Markdown>
    </div>
  );
}
