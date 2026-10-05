import { useState } from "react";
import type { ReactNode } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { TranslationKey } from "../i18n";
import {
  TAILSCALE_DOWNLOAD_URL,
  TAILSCALE_SERVE_DOC_URL,
} from "../lib/urls";

const TAILSCALE_SERVE_COMMAND = "tailscale serve --bg 12345";

interface DocsPageProps {
  t: (key: TranslationKey) => string;
}

function CodeBlock({
  command,
  copyLabel,
  copiedLabel,
}: {
  command: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

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
        onClick={() => void handleCopy()}
        aria-label={copied ? copiedLabel : copyLabel}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

function InlineCode({ children }: { children: string }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
      {children}
    </code>
  );
}

function Step({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {index}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {children}
      </div>
    </li>
  );
}

const STEP_BODY_CLASS = "text-sm leading-relaxed text-muted-foreground";
const STEP_HINT_CLASS = "text-xs leading-relaxed text-muted-foreground";

export function DocsPage({ t }: DocsPageProps) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="mb-8 flex flex-col gap-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("docs.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("docs.subtitle")}</p>
      </div>

      <article className="rounded-xl border border-border bg-card p-6 text-start sm:p-8">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {t("docs.tailscale.title")}
        </h2>
        <p className={`mt-2 ${STEP_BODY_CLASS}`}>{t("docs.tailscale.intro")}</p>

        <ol className="mt-8 flex flex-col gap-8">
          <Step index={1} title={t("docs.tailscale.step1.title")}>
            <p className={STEP_BODY_CLASS}>{t("docs.tailscale.step1.desc")}</p>
            <a
              href={TAILSCALE_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              tailscale.com/download
              <ExternalLink className="size-3" />
            </a>
          </Step>

          <Step index={2} title={t("docs.tailscale.step2.title")}>
            <p className={STEP_BODY_CLASS}>{t("docs.tailscale.step2.desc")}</p>
            <CodeBlock
              command={TAILSCALE_SERVE_COMMAND}
              copyLabel={t("hero.copyCommand")}
              copiedLabel={t("hero.copied")}
            />
            <p className={STEP_HINT_CLASS}>{t("docs.tailscale.step2.hint")}</p>
            <p className={STEP_HINT_CLASS}>
              {t("docs.tailscale.step2.macosHint")}{" "}
              <InlineCode>/Applications/Tailscale.app/Contents/MacOS/Tailscale</InlineCode>
            </p>
          </Step>

          <Step index={3} title={t("docs.tailscale.step3.title")}>
            <p className={STEP_BODY_CLASS}>{t("docs.tailscale.step3.desc")}</p>
          </Step>

          <Step index={4} title={t("docs.tailscale.step4.title")}>
            <p className={STEP_BODY_CLASS}>{t("docs.tailscale.step4.desc")}</p>
          </Step>

          <Step index={5} title={t("docs.tailscale.step5.title")}>
            <p className={STEP_BODY_CLASS}>{t("docs.tailscale.step5.desc")}</p>
          </Step>
        </ol>

        <div className="mt-10 border-t border-border pt-6">
          <h3 className="text-sm font-semibold text-foreground">
            {t("docs.tailscale.notes.title")}
          </h3>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
            <li className="flex flex-wrap items-center gap-2">
              <InlineCode>tailscale serve status</InlineCode>
              {t("docs.tailscale.notes.status")}
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <InlineCode>tailscale serve reset</InlineCode>
              {t("docs.tailscale.notes.off")}
            </li>
            <li className="leading-relaxed">{t("docs.tailscale.notes.https")}</li>
          </ul>
          <a
            href={TAILSCALE_SERVE_DOC_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("docs.tailscale.notes.docs")}
            <ExternalLink className="size-3" />
          </a>
        </div>
      </article>
    </div>
  );
}
