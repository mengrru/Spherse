import { useEffect, useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import { useProjectCtx } from "../../lib/project-context";
import { WELCOME_PAGE_SETTINGS_CHANGED_EVENT } from "../../lib/events";

const HTML_EXTENSIONS = new Set(["html", "htm"]);

function getFileExtension(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return ext;
}

export function WelcomePage({
  fallback,
}: {
  fallback: React.ReactNode;
}) {
  const { t } = useI18n();
  const { client } = useProjectCtx();
  const [path, setPath] = useState<string | null | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadWelcomePage = async () => {
      setLoadError(false);
      try {
        const settings = await client.getWelcomePageSettings();
        if (!settings.path) {
          if (!cancelled) setPath(null);
          return;
        }

        const res = await fetch(client.getPreviewUrl(settings.path));
        if (!cancelled) setPath(res.ok ? settings.path : null);
      } catch {
        if (!cancelled) setPath(null);
      }
    };

    void loadWelcomePage();
    window.addEventListener(WELCOME_PAGE_SETTINGS_CHANGED_EVENT, loadWelcomePage);

    return () => {
      cancelled = true;
      window.removeEventListener(WELCOME_PAGE_SETTINGS_CHANGED_EVENT, loadWelcomePage);
    };
  }, [client]);

  if (path === undefined) return null;
  if (path === null) return <>{fallback}</>;

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>{t("welcome-page.loadFailed")}</p>
      </div>
    );
  }

  const ext = getFileExtension(path);
  const isHtml = HTML_EXTENSIONS.has(ext);

  if (isHtml) {
    return (
      <iframe
        src={client.getPreviewUrl(path)}
        className="flex-1 w-full border-0"
        title="Welcome Page"
        sandbox="allow-scripts allow-same-origin"
        onError={() => setLoadError(true)}
      />
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <img
        src={client.getPreviewUrl(path)}
        alt="Welcome Page"
        className="max-h-full max-w-full object-contain"
        onError={() => setLoadError(true)}
      />
    </div>
  );
}
