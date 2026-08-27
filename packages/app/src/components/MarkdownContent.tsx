import { useMemo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeSlug from "rehype-slug";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./CodeBlock";
import { remarkPlainStructure } from "./remark-plain-structure";

interface MarkdownContentProps {
  children: string;
  variant?: "chat" | "document";
  plain?: boolean;
  resolveImageSrc?: (src: string) => string;
  linkClassName?: string;
  onLinkClick?: (href: string, event: React.MouseEvent<HTMLAnchorElement>) => void;
}

const PLAIN_ALLOWED_ELEMENTS = ["p", "br", "blockquote", "pre", "code", "a"];

function imgClassName(variant: "chat" | "document"): string {
  return variant === "chat"
    ? "my-2 max-w-full rounded-md"
    : "my-3 max-w-full rounded-lg border border-border";
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
    <code data-md-code-inline className={cn("rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]", className)} {...props} />
  ),
  pre: ({ className, ...props }) => (
    <CodeBlock className={cn("mb-3 p-3 overflow-x-auto rounded-md bg-muted font-mono text-xs", className)} {...props} />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote data-md-quote className={cn("mb-3 rounded-r border-l-4 border-border bg-muted/50 pl-3 text-foreground/80 text-[13px] italic", className)} {...props} />
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
  img: ({ className, ...props }) => (
    <img data-md-img className={cn(imgClassName("document"), className)} {...props} />
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
    <code data-md-code-inline className={cn("rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]", className)} {...props} />
  ),
  pre: ({ className, ...props }) => (
    <CodeBlock className={cn("mb-2 p-2 overflow-x-auto rounded-md bg-muted font-mono text-xs", className)} {...props} />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote data-md-quote className={cn("mb-3 rounded-r border-l-4 border-border bg-muted/50 pl-3 text-foreground/80 text-[13px] italic", className)} {...props} />
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
  img: ({ className, ...props }) => (
    <img data-md-img className={cn(imgClassName("chat"), className)} {...props} />
  ),
};

export function MarkdownContent({ children, variant = "document", plain, resolveImageSrc, linkClassName, onLinkClick }: MarkdownContentProps) {
  const components = useMemo<Components>(() => {
    const base = variant === "chat" ? CHAT_COMPONENTS : DOCUMENT_COMPONENTS;
    const overrides: Partial<Components> = {};
    if (resolveImageSrc) {
      overrides.img = ({ src, alt, ...props }) => (
        <img
          data-md-img
          src={resolveImageSrc(String(src ?? ""))}
          alt={alt ?? ""}
          className={imgClassName(variant)}
          {...props}
        />
      );
    }
    if (onLinkClick || linkClassName) {
      overrides.a = ({ className, href, ...props }) => (
        <a
          className={cn("text-primary underline underline-offset-4", linkClassName, className)}
          href={href}
          onClick={(event) => {
            if (!onLinkClick || !href) return;
            onLinkClick(href, event);
          }}
          {...props}
        />
      );
    }
    if (Object.keys(overrides).length === 0) return base;
    return { ...base, ...overrides };
  }, [variant, resolveImageSrc, linkClassName, onLinkClick]);

  return (
    <div className={variant === "chat" ? "text-sm leading-6" : "text-sm leading-7"}>
      <Markdown
        remarkPlugins={plain ? [remarkGfm, remarkPlainStructure, remarkBreaks] : [remarkGfm]}
        rehypePlugins={[rehypeSlug]}
        allowedElements={plain ? PLAIN_ALLOWED_ELEMENTS : undefined}
        unwrapDisallowed={plain}
        components={components}
      >
        {children}
      </Markdown>
    </div>
  );
}
