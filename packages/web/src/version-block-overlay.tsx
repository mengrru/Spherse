import { DEFAULT_LOCALE, translate } from "@spherse/i18n";
import { Button } from "@spherse/app/src/components/ui/button";
import { useSettingsStore } from "@spherse/app/src/stores/settings-store";
import { WEB_CONNECTION_STORAGE_KEY } from "./host-bridge-web";

declare const __SPHERSE_WEB_VERSION__: string;

export function VersionBlockOverlay({
  appVersion,
  onDismiss,
}: {
  appVersion: string;
  onDismiss: () => void;
}) {
  const locale = useSettingsStore((state) => state.locale) ?? DEFAULT_LOCALE;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-sm text-center">
        <h1 className="mb-3 text-xl font-semibold">
          {translate(locale, "web-version.incompatibleTitle")}
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {translate(locale, "web-version.incompatibleBody", {
            appVersion,
            webVersion: __SPHERSE_WEB_VERSION__,
          })}
        </p>
        <div className="flex justify-center gap-3">
          <Button onClick={() => window.location.reload()}>
            {translate(locale, "web-version.reload")}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              localStorage.removeItem(WEB_CONNECTION_STORAGE_KEY);
              window.location.reload();
            }}
          >
            {translate(locale, "web-version.reconnect")}
          </Button>
        </div>
        <Button
          variant="ghost"
          className="mt-4 text-muted-foreground underline-offset-4 hover:underline"
          onClick={onDismiss}
        >
          {translate(locale, "web-version.dismiss")}
        </Button>
      </div>
    </div>
  );
}
