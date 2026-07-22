import { useEffect } from "react";
import { useRouteError } from "react-router";
import { DEFAULT_LOCALE, translate } from "@spherse/i18n";
import { useSettingsStore } from "../stores/settings-store";

export function GlobalErrorBoundary() {
  const error = useRouteError();
  const locale = useSettingsStore((s) => s.locale) ?? DEFAULT_LOCALE;

  useEffect(() => {
    console.error("[GlobalErrorBoundary]", error);
  }, [error]);

  return (
    <div data-app-root className="flex h-dvh flex-col items-center justify-center gap-4 bg-background p-8 text-center text-foreground">
      <h1 className="text-xl font-semibold">{translate(locale, "error.unexpectedTitle")}</h1>
      <p className="text-sm text-muted-foreground">{translate(locale, "error.unexpectedMessage")}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {translate(locale, "error.reload")}
        </button>
        <button
          type="button"
          onClick={() => {
            window.location.hash = "#/";
          }}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
        >
          {translate(locale, "error.goHome")}
        </button>
      </div>
    </div>
  );
}
