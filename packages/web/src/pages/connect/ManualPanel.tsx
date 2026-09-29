import { useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@spherse/app/ui/button";
import { Input } from "@spherse/app/ui/input";
import { Field, FieldLabel } from "@spherse/app/ui/field";
import type { ConnectPayload } from "@spherse/app/connect-payload";

export function ManualPanel({
  submitting,
  onBack,
  onSubmit,
}: {
  submitting: boolean;
  onBack: () => void;
  onSubmit: (conn: ConnectPayload) => void | Promise<void>;
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
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onBack} disabled={submitting}>
          <ArrowLeftIcon className="size-4" />
          {t("mobile-connect.back")}
        </Button>
        <Button type="submit" disabled={!canSubmit} className="flex-1">
          {submitting ? t("common.loading") : t("mobile-connect.connect")}
        </Button>
      </div>
    </form>
  );
}
