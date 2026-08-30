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
import { Field } from "../../components/ui/field";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select";
import { useI18n } from "@spherse/i18n/react";
import { cn } from "@/lib/utils";
import type { ProviderCatalogItem, ThinkingLevel } from "@spherse/core";
import { HintLabel } from "./HintLabel";

const THINKING_LEVELS: ThinkingLevel[] = ["off", "low", "medium", "high"];
const FOLLOW_DEFAULT = "__follow_default__";

export function modelExistsInCatalog(
  modelId: string,
  providers: Record<string, ProviderCatalogItem>,
): boolean {
  const slashIdx = modelId.indexOf("/");
  if (slashIdx < 0) {
    return Object.values(providers).some((config) =>
      config.models.some((m) => m.id === modelId),
    );
  }
  const providerId = modelId.slice(0, slashIdx);
  const modelPart = modelId.slice(slashIdx + 1);
  return providers[providerId]?.models.some((m) => m.id === modelPart) ?? false;
}

interface ModelConfigFieldProps {
  providers: Record<string, ProviderCatalogItem>;
  model: string | undefined;
  thinkingLevel: ThinkingLevel | undefined;
  onModelChange: (model: string | undefined) => void;
  onThinkingLevelChange: (level: ThinkingLevel | undefined) => void;
}

export function ModelConfigField({
  providers,
  model,
  thinkingLevel,
  onModelChange,
  onThinkingLevelChange,
}: ModelConfigFieldProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");

  const providerEntries = Object.entries(providers).filter(([, config]) => config.models.length > 0);

  const selectedLabel = (() => {
    if (!model) return t("settings.models.defaultModel");
    const slashIdx = model.indexOf("/");
    if (slashIdx < 0) {
      const found = Object.values(providers)
        .flatMap((config) => config.models)
        .find((m) => m.id === model);
      return found?.name ?? model;
    }
    const providerId = model.slice(0, slashIdx);
    const modelPart = model.slice(slashIdx + 1);
    const found = providers[providerId]?.models.find((m) => m.id === modelPart);
    return found?.name ?? model;
  })();

  const lowerQuery = query.trim().toLowerCase();
  const filtered = providerEntries
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
      <HintLabel hint={t("agent-dialog.modelHint")}>{t("agent-dialog.modelLabel")}</HintLabel>
      <Combobox
        value={model ?? FOLLOW_DEFAULT}
        onValueChange={(v) => {
          const next = v as string;
          onModelChange(next === FOLLOW_DEFAULT ? undefined : next);
        }}
        filter={null}
        defaultInputValue=""
        onInputValueChange={(input) => setQuery(input)}
        onOpenChange={(open) => { if (open) setQuery(""); }}
      >
        <ComboboxTrigger>
          <span className={cn("flex-1 truncate text-start", !model && "text-muted-foreground")}>
            {selectedLabel}
          </span>
          <ComboboxIcon />
        </ComboboxTrigger>
        <ComboboxContent>
          <ComboboxInput placeholder={t("settings.models.searchPlaceholder")} />
          <ComboboxList>
            <ComboboxItem value={FOLLOW_DEFAULT}>
              {t("settings.models.defaultModel")}
            </ComboboxItem>
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
      <div className="mt-2 space-y-1.5">
        <HintLabel hint={t("agent-dialog.thinkingLevelHint")}>
          {t("settings.models.thinkingLevel")}
        </HintLabel>
        <NativeSelect
          className="w-full"
          value={thinkingLevel ?? FOLLOW_DEFAULT}
          onChange={(e) =>
            onThinkingLevelChange(
              e.target.value === FOLLOW_DEFAULT ? undefined : (e.target.value as ThinkingLevel),
            )
          }
        >
          <NativeSelectOption value={FOLLOW_DEFAULT}>
            {t("agent-dialog.thinkingLevelFollowGlobal")}
          </NativeSelectOption>
          {THINKING_LEVELS.map((level) => (
            <NativeSelectOption key={level} value={level}>
              {t(`settings.models.thinkingLevel.${level}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
    </Field>
  );
}
