import type { ReactNode } from "react";
import { useI18n } from "@spherse/i18n/react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "../../components/ui/context-menu";

export function TabContextMenu({
  closeOthersDisabled,
  onCloseOthers,
  children,
}: {
  closeOthersDisabled: boolean;
  onCloseOthers: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <ContextMenu>
      <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={closeOthersDisabled} onClick={onCloseOthers}>
          {t("tabs.closeOthers")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
