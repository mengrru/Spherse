import { useI18n } from "@spherse/i18n/react";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "../../components/ui/field";
import { Button } from "../../components/ui/button";
import { TRANSPORT_OPTIONS, type McpServerDraft } from "./mcp-form-helpers";

interface McpServerFormProps {
  draft: McpServerDraft;
  onChange: (patch: Partial<McpServerDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function McpServerForm({ draft, onChange, onSave, onCancel }: McpServerFormProps) {
  const { t } = useI18n();

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <FieldGroup>
        <Field>
          <FieldLabel>{t("agent-mcp.fieldName")}</FieldLabel>
          <Input
            value={draft.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={t("agent-mcp.fieldNamePlaceholder")}
          />
        </Field>

        <Field>
          <FieldLabel>{t("agent-mcp.fieldTransport")}</FieldLabel>
          <div className="flex gap-1">
            {TRANSPORT_OPTIONS.map((opt) => (
              <Button
                key={opt}
                type="button"
                variant={draft.transport === opt ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => onChange({ transport: opt })}
              >
                {t(`agent-mcp.transport-${opt}`)}
              </Button>
            ))}
          </div>
        </Field>

        {draft.transport === "stdio" ? (
          <>
            <Field>
              <FieldLabel>{t("agent-mcp.fieldCommand")}</FieldLabel>
              <Input
                value={draft.command}
                onChange={(e) => onChange({ command: e.target.value })}
                placeholder={t("agent-mcp.fieldCommandPlaceholder")}
              />
            </Field>
            <Field>
              <FieldLabel>{t("agent-mcp.fieldArgs")}</FieldLabel>
              <Textarea
                value={draft.args}
                onChange={(e) => onChange({ args: e.target.value })}
                placeholder={t("agent-mcp.fieldArgsPlaceholder")}
                rows={2}
                className="font-mono text-xs"
              />
            </Field>
            <Field>
              <FieldLabel>{t("agent-mcp.fieldEnv")}</FieldLabel>
              <Textarea
                value={draft.env}
                onChange={(e) => onChange({ env: e.target.value })}
                placeholder={t("agent-mcp.fieldEnvPlaceholder")}
                rows={2}
                className="font-mono text-xs"
              />
            </Field>
          </>
        ) : (
          <>
            <Field>
              <FieldLabel>{t("agent-mcp.fieldUrl")}</FieldLabel>
              <Input
                value={draft.url}
                onChange={(e) => onChange({ url: e.target.value })}
                placeholder={t("agent-mcp.fieldUrlPlaceholder")}
              />
            </Field>
            <Field>
              <FieldLabel>{t("agent-mcp.fieldHeaders")}</FieldLabel>
              <Textarea
                value={draft.headers}
                onChange={(e) => onChange({ headers: e.target.value })}
                placeholder={t("agent-mcp.fieldHeadersPlaceholder")}
                rows={2}
                className="font-mono text-xs"
              />
            </Field>
          </>
        )}
      </FieldGroup>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="button" size="sm" onClick={onSave}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
