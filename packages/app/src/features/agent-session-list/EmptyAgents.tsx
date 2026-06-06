import { useI18n } from "@spherse/i18n/react";

export function EmptyAgents() {
  const { t } = useI18n();
  return <p className="px-2 text-xs text-sidebar-foreground/70">{t("agent-session-list.emptyAgents")}</p>;
}
