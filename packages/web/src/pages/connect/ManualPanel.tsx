import { useI18n } from "@spherse/i18n/react";
import { ArrowLeftIcon, XIcon } from "lucide-react";
import { Button } from "@spherse/app/ui/button";
import { Input } from "@spherse/app/ui/input";
import { Field, FieldLabel } from "@spherse/app/ui/field";
import type { ConnectPayload } from "@spherse/app/connect-payload";

export function ManualPanel({
  baseUrl,
  token,
  submitting,
  onBaseUrlChange,
  onTokenChange,
  onBack,
  onSubmit,
}: {
  baseUrl: string;
  token: string;
  submitting: boolean;
  onBaseUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onBack: () => void;
  onSubmit: (conn: ConnectPayload) => void | Promise<void>;
}) {
  const { t } = useI18n();

  const canSubmit = baseUrl.trim() !== "" && token.trim() !== "" && !submitting;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    void onSubmit({ baseUrl: baseUrl.trim(), token: token.trim() });
  };

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <ClearableField
        label={t("mobile-connect.baseUrl")}
        value={baseUrl}
        onChange={onBaseUrlChange}
        placeholder="https://example.trycloudflare.com"
      />
      <ClearableField
        label={t("mobile-connect.token")}
        value={token}
        onChange={onTokenChange}
      />
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

function ClearableField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const { t } = useI18n();
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          type="text"
          className="h-11 pe-9 text-base md:text-base"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {value !== "" && (
          <button
            type="button"
            className="absolute end-2.5 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => onChange("")}
            aria-label={t("common.clear")}
          >
            <XIcon className="size-4" />
          </button>
        )}
      </div>
    </Field>
  );
}
