import { useEffect, useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import type { CustomProviderDef } from "@spherse/core";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { customProviderDefaults } from "./custom-provider-defaults";

interface CustomProviderDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (def: CustomProviderDef) => void;
  initial?: CustomProviderDef;
}

function parseModelIds(text: string): string[] {
  const parts = text
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return [...new Set(parts)];
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parsePositiveInt(value: string): number | undefined {
  if (value.trim().length === 0) return undefined;
  if (!/^\d+$/.test(value.trim())) return NaN;
  const parsed = Number(value.trim());
  return parsed > 0 ? parsed : NaN;
}

const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_|~`0-9A-Za-z-]+$/;
// eslint-disable-next-line no-control-regex
const HEADER_VALUE_FORBIDDEN_PATTERN = /[\x00-\x1f\x7f]/;

function parseHeaders(text: string): { headers: Record<string, string> } | { invalidLine: number } | undefined {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return undefined;
  const headers: Record<string, string> = {};
  for (const [index, line] of lines.entries()) {
    const colonIdx = line.indexOf(":");
    const name = colonIdx > 0 ? line.slice(0, colonIdx).trim() : "";
    const value = colonIdx >= 0 ? line.slice(colonIdx + 1).trim() : "";
    if (!HEADER_NAME_PATTERN.test(name) || value.length === 0) {
      return { invalidLine: index + 1 };
    }
    if (HEADER_VALUE_FORBIDDEN_PATTERN.test(value)) {
      return { invalidLine: index + 1 };
    }
    headers[name] = value;
  }
  return { headers };
}

export function CustomProviderDialog({
  open,
  onClose,
  onSubmit,
  initial,
}: CustomProviderDialogProps) {
  const { t } = useI18n();

  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelsText, setModelsText] = useState("");
  const [keyless, setKeyless] = useState(false);
  const [contextWindowText, setContextWindowText] = useState("");
  const [maxTokensText, setMaxTokensText] = useState("");
  const [headersText, setHeadersText] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setBaseUrl(initial?.baseUrl ?? "");
    setModelsText(initial?.models?.join("\n") ?? "");
    setKeyless(initial?.keyless ?? false);
    setContextWindowText(initial?.contextWindow != null ? String(initial.contextWindow) : "");
    setMaxTokensText(initial?.maxTokens != null ? String(initial.maxTokens) : "");
    setHeadersText(
      initial?.headers ? Object.entries(initial.headers).map(([n, v]) => `${n}: ${v}`).join("\n") : "",
    );
  }, [open, initial]);

  const parsedModels = parseModelIds(modelsText);
  const trimmedName = name.trim();
  const trimmedBaseUrl = baseUrl.trim();
  const contextWindow = parsePositiveInt(contextWindowText);
  const maxTokens = parsePositiveInt(maxTokensText);
  const parsedHeaders = parseHeaders(headersText);
  const headersValue = parsedHeaders && "headers" in parsedHeaders ? parsedHeaders.headers : undefined;

  const nameError =
    trimmedName.length === 0
      ? t("settings.provider.dialog.errNameRequired")
      : "";
  const baseUrlError =
    trimmedBaseUrl.length === 0
      ? t("settings.provider.dialog.errBaseUrlRequired")
      : isHttpUrl(trimmedBaseUrl)
        ? ""
        : t("settings.provider.dialog.errBaseUrlInvalid");
  const modelsError =
    parsedModels.length === 0
      ? t("settings.provider.dialog.errModelsRequired")
      : "";
  const contextWindowError =
    contextWindowText.trim().length === 0 || !Number.isNaN(contextWindow)
      ? ""
      : t("settings.provider.dialog.errLimitInvalid");
  const maxTokensError =
    maxTokensText.trim().length === 0 || !Number.isNaN(maxTokens)
      ? ""
      : t("settings.provider.dialog.errLimitInvalid");
  const headersError =
    parsedHeaders && "invalidLine" in parsedHeaders
      ? t("settings.provider.dialog.errHeadersInvalid", { line: parsedHeaders.invalidLine })
      : "";

  const hasErrors = Boolean(
    nameError || baseUrlError || modelsError || contextWindowError || maxTokensError || headersError,
  );

  const handleSubmit = () => {
    if (hasErrors) return;
    onSubmit({
      id: initial?.id ?? "",
      name: trimmedName,
      baseUrl: trimmedBaseUrl,
      models: parsedModels,
      keyless,
      ...(contextWindow !== undefined && !Number.isNaN(contextWindow)
        ? { contextWindow }
        : {}),
      ...(maxTokens !== undefined && !Number.isNaN(maxTokens) ? { maxTokens } : {}),
      ...(headersValue ? { headers: headersValue } : {}),
    });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(openValue) => {
        if (!openValue) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {initial
              ? t("settings.provider.dialog.titleEdit")
              : t("settings.provider.dialog.titleAdd")}
          </DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="custom-provider-name">
              {t("settings.provider.dialog.name")}
            </FieldLabel>
            <Input
              id="custom-provider-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("settings.provider.dialog.namePlaceholder")}
              aria-invalid={Boolean(nameError)}
            />
            {nameError ? <FieldError>{nameError}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="custom-provider-base-url">
              {t("settings.provider.dialog.baseUrl")}
            </FieldLabel>
            <Input
              id="custom-provider-base-url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={t("settings.provider.dialog.baseUrlPlaceholder")}
              aria-invalid={Boolean(baseUrlError)}
            />
            {baseUrlError ? <FieldError>{baseUrlError}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="custom-provider-models">
              {t("settings.provider.dialog.models")}
            </FieldLabel>
            <Textarea
              id="custom-provider-models"
              value={modelsText}
              onChange={(event) => setModelsText(event.target.value)}
              placeholder={t("settings.provider.dialog.modelsPlaceholder")}
              aria-invalid={Boolean(modelsError)}
            />
            <FieldDescription>
              {t("settings.provider.dialog.modelsHint")}
            </FieldDescription>
            {modelsError ? <FieldError>{modelsError}</FieldError> : null}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="custom-provider-context-window">
                {t("settings.provider.dialog.contextWindow")}
              </FieldLabel>
              <Input
                id="custom-provider-context-window"
                type="number"
                inputMode="numeric"
                min={1}
                value={contextWindowText}
                onChange={(event) => setContextWindowText(event.target.value)}
                placeholder={t("settings.provider.dialog.contextWindowPlaceholder", {
                  value: customProviderDefaults.contextWindow,
                })}
                aria-invalid={Boolean(contextWindowError)}
              />
              {contextWindowError ? <FieldError>{contextWindowError}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="custom-provider-max-tokens">
                {t("settings.provider.dialog.maxTokens")}
              </FieldLabel>
              <Input
                id="custom-provider-max-tokens"
                type="number"
                inputMode="numeric"
                min={1}
                value={maxTokensText}
                onChange={(event) => setMaxTokensText(event.target.value)}
                placeholder={t("settings.provider.dialog.maxTokensPlaceholder", {
                  value: customProviderDefaults.maxTokens,
                })}
                aria-invalid={Boolean(maxTokensError)}
              />
              {maxTokensError ? <FieldError>{maxTokensError}</FieldError> : null}
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("settings.provider.dialog.limitsHint")}
          </p>
          <Field>
            <FieldLabel htmlFor="custom-provider-headers">
              {t("settings.provider.dialog.headers")}
            </FieldLabel>
            <Textarea
              id="custom-provider-headers"
              value={headersText}
              onChange={(event) => setHeadersText(event.target.value)}
              placeholder={t("settings.provider.dialog.headersPlaceholder")}
              aria-invalid={Boolean(headersError)}
              rows={2}
            />
            <FieldDescription>
              {t("settings.provider.dialog.headersHint")}
            </FieldDescription>
            {headersError ? <FieldError>{headersError}</FieldError> : null}
          </Field>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium leading-none">
                {t("settings.provider.dialog.keyless")}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("settings.provider.dialog.keylessDesc")}
              </span>
            </div>
            <Switch checked={keyless} onCheckedChange={setKeyless} />
          </div>
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("settings.provider.dialog.cancel")}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={hasErrors}>
            {t("settings.provider.dialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
