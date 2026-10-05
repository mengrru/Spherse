import { useState, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { cn } from "../lib/utils";
import type { TranslationKey } from "../i18n";

interface DocMarkdownProps {
  t: (key: TranslationKey) => string;
  children: string;
}

function extractText(node: ReactNode): string {
  if (node === null || node === undefined || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

function CodeBlock({ children, copyLabel, copiedLabel }: { children: ReactNode; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const command = extractText(children).trim();

  const handleCopy = () => {
    void navigator.clipboard
      .writeText(command)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  };

  return (
    <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 font-mono text-sm">
      <code className="min-w-0 flex-1 break-all text-foreground">{command}</code>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? copiedLabel : copyLabel}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

function createComponents(copyLabel: string, copiedLabel: string): Components {
  return {
    h1: ({ className, ...props }) => (
      <h1 className={cn("text-lg font-semibold tracking-tight text-foreground", className)} {...props} />
    ),
    h2: ({ className, ...props }) => (
      <h2 className={cn("mt-8 text-sm font-semibold text-foreground", className)} {...props} />
    ),
    h3: ({ className, ...props }) => (
      <h3 className={cn("mt-6 text-sm font-medium text-foreground", className)} {...props} />
    ),
    p: ({ className, ...props }) => (
      <p className={cn("mt-3 text-sm leading-relaxed text-muted-foreground", className)} {...props} />
    ),
    ul: ({ className, ...props }) => (
      <ul className={cn("mt-3 list-disc ps-5 text-sm leading-relaxed text-muted-foreground", className)} {...props} />
    ),
    ol: ({ className, ...props }) => (
      <ol className={cn("mt-3 list-decimal ps-5 text-sm leading-relaxed text-muted-foreground", className)} {...props} />
    ),
    li: ({ className, ...props }) => (
      <li className={cn("mt-1.5", className)} {...props} />
    ),
    strong: ({ className, ...props }) => (
      <strong className={cn("font-medium text-foreground", className)} {...props} />
    ),
    code: ({ className, ...props }) => (
      <code
        className={cn(
          "rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground",
          className,
        )}
        {...props}
      />
    ),
    pre: ({ children }) => (
      <div className="mt-3">
        <CodeBlock copyLabel={copyLabel} copiedLabel={copiedLabel}>
          {children}
        </CodeBlock>
      </div>
    ),
    a: ({ className, href, children, ...props }) => (
      <a
        href={href}
        target={href?.startsWith("http") ? "_blank" : undefined}
        rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
        className={cn("text-foreground underline underline-offset-4", className)}
        {...props}
      >
        {children}
      </a>
    ),
  };
}

export function DocMarkdown({ t, children }: DocMarkdownProps) {
  return (
    <div className="text-sm">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={createComponents(t("hero.copyCommand"), t("hero.copied"))}
      >
        {children}
      </Markdown>
    </div>
  );
}
