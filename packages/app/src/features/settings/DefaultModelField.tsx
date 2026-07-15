import { useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxIcon,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "../../components/ui/combobox";
import { Field, FieldLabel } from "../../components/ui/field";
import { useI18n } from "@spherse/i18n/react";
import { cn } from "@/lib/utils";
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
  const [query, setQuery] = useState("");

  const configuredProviders = Object.entries(providers).filter(([id]) => apiKeys[id]?.trim());

  const selectedLabel = (() => {
    const slashIdx = value.indexOf("/");
    if (slashIdx < 0) return value || "";
    const providerId = value.slice(0, slashIdx);
    const modelId = value.slice(slashIdx + 1);
    const config = providers[providerId];
    const model = config?.models.find((m) => m.id === modelId);
    return model?.name ?? value;
  })();

  const lowerQuery = query.trim().toLowerCase();
  const filtered = configuredProviders
    .map(([id, config]) => {
      const providerMatch = config.name.toLowerCase().includes(lowerQuery);
      const models = providerMatch
        ? config.models
        : config.models.filter((m) => m.name.toLowerCase().includes(lowerQuery));
      return { id, config, models };
    })
    .filter((g) => g.models.length > 0);

  return (
    <Field>
      <SectionTitle as={FieldLabel}>{t("settings.models.defaultModel")}</SectionTitle>
      {configuredProviders.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("settings.models.configureFirst")}</p>
      ) : (
        <Combobox
          value={value || null}
          onValueChange={(v) => onChange((v as string) ?? "")}
          filter={null}
          defaultInputValue=""
          onInputValueChange={(input) => setQuery(input)}
          onOpenChange={(open) => { if (open) setQuery(""); }}
        >
          <ComboboxTrigger>
            <span className={cn("flex-1 truncate text-start", !value && "text-muted-foreground")}>
              {value ? selectedLabel : t("settings.models.selectPlaceholder")}
            </span>
            <ComboboxIcon />
          </ComboboxTrigger>
          <ComboboxContent>
            <ComboboxInput placeholder={t("settings.models.searchPlaceholder")} />
            <ComboboxList>
              {filtered.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                  {t("settings.models.noResults")}
                </p>
              ) : (
                filtered.map(({ id, config, models }) => (
                  <ComboboxGroup key={id}>
                    <ComboboxGroupLabel>{config.name}</ComboboxGroupLabel>
                    {models.map((m) => (
                      <ComboboxItem key={`${id}/${m.id}`} value={`${id}/${m.id}`}>
                        {m.name}
                      </ComboboxItem>
                    ))}
                  </ComboboxGroup>
                ))
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      )}
    </Field>
  );
}
