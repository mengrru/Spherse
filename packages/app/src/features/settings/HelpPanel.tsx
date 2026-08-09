import { FieldGroup } from "../../components/ui/field";
import { SectionTitle } from "./SectionTitle";
import { useHostBridge } from "../../context/host-bridge-context";
import { useI18n } from "@spherse/i18n/react";

const DOCS_URL = "https://spherse.mengru.work/docs";

export function HelpPanel() {
  const { t } = useI18n();
  const bridge = useHostBridge();
  return (
    <FieldGroup>
      <SectionTitle>{t("settings.help.title")}</SectionTitle>
      <p className="text-sm text-muted-foreground">{t("settings.help.description")}</p>
      <a
        href={DOCS_URL}
        onClick={(e) => {
          e.preventDefault();
          void bridge.openExternal(DOCS_URL);
        }}
        className="mt-1 inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/80"
      >
        {t("settings.help.openDocs")}
      </a>
    </FieldGroup>
  );
}
