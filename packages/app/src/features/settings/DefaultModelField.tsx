import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "../../components/ui/native-select";
import { Field } from "../../components/ui/field";
import { FieldLabel } from "../../components/ui/field";
import { useI18n } from "@spherse/i18n/react";
import type { ProviderConfig } from "./types";
import { SectionTitle } from "./SectionTitle";

export function DefaultModelField({
  providers,
  apiKeys,
  value,
  onChange,
}: {
  providers: Record<string, ProviderConfig>;
  apiKeys: Record<string, string>;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const configuredProviders = Object.entries(providers).filter(([id]) => apiKeys[id]?.trim());

  return (
    <Field>
      <SectionTitle as={FieldLabel}>{t("settings.models.defaultModel")}</SectionTitle>
      <NativeSelect className="w-full" value={value} onChange={(e) => onChange(e.target.value)}>
        <NativeSelectOption value="">{t("settings.models.selectPlaceholder")}</NativeSelectOption>
        {configuredProviders.map(([id, config]) => (
          <NativeSelectOptGroup key={id} label={config.name}>
            {config.models.map((m) => (
              <NativeSelectOption key={`${id}/${m.id}`} value={`${id}/${m.id}`}>
                {m.name}
              </NativeSelectOption>
            ))}
          </NativeSelectOptGroup>
        ))}
      </NativeSelect>
      {configuredProviders.length === 0 && (
        <p className="mt-1.5 text-xs text-muted-foreground">{t("settings.models.configureFirst")}</p>
      )}
    </Field>
  );
}
