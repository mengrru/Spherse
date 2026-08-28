import { useEffect, useState } from "react";
import { ChevronDown, Download, ExternalLink } from "lucide-react";
import { FALLBACK_URL, fetchLatestManifest, type Manifest } from "../lib/release";
import { fetchChangelog, type Changelog } from "../lib/changelog";
import { InstallTip } from "./InstallTip";
import type { TranslationKey } from "../i18n";

const GITHUB_TAG_URL_BASE = "https://github.com/mengrru/Spherse/releases/tag";

const TYPE_BADGE_CLASS: Record<string, string> = {
  feat: "bg-success/10 text-success",
  fix: "bg-warning/10 text-warning",
};

const NEUTRAL_BADGE_CLASS = "bg-muted text-muted-foreground";

interface DownloadPageProps {
  t: (key: TranslationKey) => string;
}

interface PlatformCard {
  key: string;
  labelKey: TranslationKey;
  url: string;
}

function platformCards(manifest: Manifest): PlatformCard[] {
  const cards: PlatformCard[] = [
    { key: "mac-arm64", labelKey: "download.macArm64", url: manifest.mac?.arm64 ?? "" },
    { key: "mac-intel", labelKey: "download.macIntel", url: manifest.mac?.intel ?? "" },
    {
      key: "win-x64",
      labelKey: "download.winX64",
      url: manifest.win?.x64 ?? manifest.win?.setup ?? "",
    },
    { key: "win-arm64", labelKey: "download.winArm64", url: manifest.win?.arm64 ?? "" },
  ];
  return cards.filter((card) => card.url.length > 0);
}

function badgeClass(type: string | null): string {
  if (!type) return "";
  return TYPE_BADGE_CLASS[type] ?? NEUTRAL_BADGE_CLASS;
}

export function DownloadPage({ t }: DownloadPageProps) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestFailed, setManifestFailed] = useState(false);
  const [changelog, setChangelog] = useState<Changelog | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  useEffect(() => {
    let cancelled = false;
    fetchLatestManifest()
      .then((value) => {
        if (!cancelled) setManifest(value);
      })
      .catch(() => {
        if (!cancelled) setManifestFailed(true);
      });
    fetchChangelog()
      .then((value) => {
        if (!cancelled) setChangelog(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = manifest ? platformCards(manifest) : [];
  const releases = changelog?.releases ?? [];
  const showFallback = manifestFailed || (manifest !== null && cards.length === 0);
  const showMacTip = showFallback || cards.some((card) => card.key.startsWith("mac-"));
  const showWinTip = showFallback || cards.some((card) => card.key.startsWith("win-"));

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("download.pageTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("download.pageSubtitle")}</p>
      </div>

      <section aria-label={t("download.latestSection")}>
        {manifest && (
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1">
            <span className="text-xs text-muted-foreground">{t("download.latestLabel")}</span>
            <span className="text-sm font-medium text-foreground">v{manifest.version}</span>
          </div>
        )}
        {cards.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {cards.map((card) => (
              <a
                key={card.key}
                href={card.url}
                className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-4 transition-colors hover:border-foreground/30"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">{t(card.labelKey)}</span>
                  <span className="text-xs text-muted-foreground">{t("download.hint")}</span>
                </span>
                <span className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
                  <Download className="me-1 size-3.5" />
                  {t("download.download")}
                </span>
              </a>
            ))}
          </div>
        ) : showFallback ? (
          <a
            href={FALLBACK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center rounded-xl border border-border bg-card px-4 py-4 text-sm text-foreground transition-colors hover:border-foreground/30"
          >
            <ExternalLink className="me-2 size-4" />
            {t("download.fallback")}
          </a>
        ) : null}
        {(showMacTip || showWinTip) && (
          <div className="mt-4 flex flex-col gap-3">
            {showMacTip && <InstallTip platform="mac" t={t} />}
            {showWinTip && <InstallTip platform="win" t={t} />}
          </div>
        )}
      </section>

      {releases.length > 0 && (
        <section aria-label={t("download.changelogTitle")} className="mt-12">
          <h2 className="mb-4 text-lg font-semibold tracking-tight text-foreground">
            {t("download.changelogTitle")}
          </h2>
          <div className="flex flex-col gap-3">
            {releases.map((release, index) => {
              const open = openIndex === index;
              return (
                <div
                  key={release.tag}
                  className="overflow-hidden rounded-xl border border-border bg-card"
                >
                  <div className="flex items-center gap-2 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setOpenIndex(open ? null : index)}
                      aria-expanded={open}
                      className="flex flex-1 items-center gap-3 text-left"
                    >
                      <span className="text-sm font-medium text-foreground">
                        v{release.version}
                      </span>
                      {release.date && (
                        <span className="text-xs text-muted-foreground">{release.date}</span>
                      )}
                      <ChevronDown
                        className={`ms-auto size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                      />
                    </button>
                    <a
                      href={`${GITHUB_TAG_URL_BASE}/${release.tag}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t("download.viewOnGithub")}
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ExternalLink className="size-4" />
                    </a>
                  </div>
                  {open && (
                    <ul className="flex flex-col gap-2 border-t border-border px-4 py-3">
                      {release.notes.map((note, noteIndex) => (
                        <li key={noteIndex} className="flex items-start gap-2.5 text-sm">
                          {note.type && (
                            <span
                              className={`mt-0.5 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-none ${badgeClass(note.type)}`}
                            >
                              {note.type}
                            </span>
                          )}
                          <span className="text-foreground">{note.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
