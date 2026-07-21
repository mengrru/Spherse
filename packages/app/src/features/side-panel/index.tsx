import { useSidePanel } from "../../hooks/use-side-panel";
import { useIsMobile } from "../../hooks/use-mobile";
import { ActivityBar } from "../activity-bar";
import { ProjectPanel } from "../project-panel";
import { Button } from "../../components/ui/button";
import {
  Sheet,
  SheetContent,
} from "../../components/ui/sheet";
import { PanelLeftIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";

export function SidePanel() {
  const {
    pinned,
    visible,
    mobileOpen,
    show,
    hide,
    togglePin,
    showMobile,
    hideMobile,
  } = useSidePanel();
  const isMobile = useIsMobile();
  const { t } = useI18n();

  if (isMobile) {
    return (
      <>
        <Button
          variant="outline"
          size="icon-lg"
          className="fixed bottom-4 start-4 z-40 size-14 rounded-full bg-background shadow-lg"
          onClick={showMobile}
          aria-label={t("side-panel.openTooltip")}
          title={t("side-panel.openTooltip")}
          aria-haspopup="dialog"
          aria-expanded={mobileOpen}
        >
          <PanelLeftIcon className="size-6" />
        </Button>
        <Sheet open={mobileOpen} onOpenChange={(open) => (open ? showMobile() : hideMobile())}>
          <SheetContent
            side="left"
            showCloseButton={false}
            className="data-[side=left]:w-auto max-w-full gap-0 p-0"
          >
            <div className="flex h-full">
              <ActivityBar />
              <ProjectPanel />
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <>
      {!visible && (
        <div
          className="absolute inset-y-0 start-0 z-40 w-2"
          onMouseEnter={show}
        />
      )}
      <div
        data-side-panel
        className={
          pinned
            ? "relative z-40 flex h-full shrink-0"
            : `absolute top-0 start-0 z-40 flex h-full transition-transform duration-200 ease-out ${
                visible ? "translate-x-0" : "-translate-x-full"
              }`
        }
        {...(!pinned && {
          onMouseEnter: show,
          onMouseLeave: hide,
        })}
      >
        <ActivityBar pinToggle={{ pinned, onToggle: togglePin }} />
        <ProjectPanel />
      </div>
    </>
  );
}
