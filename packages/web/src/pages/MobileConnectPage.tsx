import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { toast } from "sonner";
import { Button } from "@spherse/app/src/components/ui/button";
import { Input } from "@spherse/app/src/components/ui/input";
import { Field, FieldLabel } from "@spherse/app/src/components/ui/field";
import { useHostBridge } from "@spherse/app/src/context/host-bridge-context";
import { useAppStore } from "@spherse/app/src/stores/app-store";

const CONNECTION_STORAGE_KEY = "spherse:connection";

interface ParsedConnection {
  baseUrl: string;
  token: string;
}

function persistConnection(conn: ParsedConnection): void {
  localStorage.setItem(
    CONNECTION_STORAGE_KEY,
    JSON.stringify({ baseUrl: conn.baseUrl.replace(/\/+$/, ""), token: conn.token }),
  );
}

export function MobileConnectPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const bridge = useHostBridge();
  const restoreProjects = useAppStore((state) => state.restoreProjects);
  const [searchParams, setSearchParams] = useSearchParams();
  const [submitting, setSubmitting] = useState(false);

  const handleConnect = async (conn: ParsedConnection, targetPath?: string) => {
    setSubmitting(true);
    try {
      persistConnection(conn);
      const firstProjectId = await restoreProjects(bridge);
      toast.success(t("mobile-connect.connected"));
      if (targetPath) {
        navigate(targetPath, { replace: true });
      } else if (firstProjectId) {
        navigate(`/project/${firstProjectId}`, { replace: true });
      } else {
        navigate("/", { replace: true });
      }
    } catch (err) {
      toast.error(t("mobile-connect.connectFailed", { error: (err as Error).message }));
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    const base = searchParams.get("base");
    const token = searchParams.get("token");
    if (!base || !token) return;
    const path = searchParams.get("targetPath");
    const cleaned = new URLSearchParams(searchParams);
    cleaned.delete("base");
    cleaned.delete("token");
    cleaned.delete("targetPath");
    setSearchParams(cleaned, { replace: true });
    void handleConnect({ baseUrl: base, token }, path ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center overflow-auto bg-background px-6 text-foreground">
      <header className="mb-8 text-center">
        <h1 className="mb-2 text-3xl font-semibold">{t("mobile-connect.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("mobile-connect.subtitle")}</p>
      </header>

      <ManualPanel submitting={submitting} onSubmit={handleConnect} />
    </div>
  );
}

function ManualPanel({
  submitting,
  onSubmit,
}: {
  submitting: boolean;
  onSubmit: (conn: ParsedConnection) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");

  const canSubmit = baseUrl.trim() !== "" && token.trim() !== "" && !submitting;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    void onSubmit({ baseUrl: baseUrl.trim(), token: token.trim() });
  };

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <Field>
        <FieldLabel>{t("mobile-connect.baseUrl")}</FieldLabel>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://example.trycloudflare.com"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </Field>
      <Field>
        <FieldLabel>{t("mobile-connect.token")}</FieldLabel>
        <Input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          type="text"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </Field>
      <Button type="submit" disabled={!canSubmit} className="w-full">
        {submitting ? t("common.loading") : t("mobile-connect.connect")}
      </Button>
    </form>
  );
}
