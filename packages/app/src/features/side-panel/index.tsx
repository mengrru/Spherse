import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { useSidePanel } from "../../hooks/use-side-panel";
import { useIsMobile } from "../../hooks/use-mobile";
import { ActivityBar } from "../activity-bar";
import { ProjectPanel } from "../project-panel";
import { Button } from "../../components/ui/button";
import { ChevronRightIcon } from "lucide-react";
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

  const location = useLocation();
  const lastLocationKey = useRef(location.key);
  useEffect(() => {
    if (location.key !== lastLocationKey.current) {
      lastLocationKey.current = location.key;
      hideMobile();
    }
  }, [location.key, hideMobile]);

  if (isMobile) {
    return (
      <>
        <Button
          variant="outline"
          className="fixed start-0 top-1/2 z-40 flex h-14 w-5 -translate-y-1/2 flex-col items-center justify-center rounded-e-md border-s-0 bg-muted shadow-sm"
          onClick={showMobile}
          aria-label={t("side-panel.openTooltip")}
          title={t("side-panel.openTooltip")}
          aria-haspopup="dialog"
          aria-expanded={mobileOpen}
        >
          <ChevronRightIcon className="size-4" />
        </Button>
        <div
          className={`fixed inset-0 z-40 bg-black/80 supports-backdrop-filter:backdrop-blur-xs transition-opacity duration-200 ${
            mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          onClick={hideMobile}
          aria-hidden={!mobileOpen}
        />
        <div
          className={`fixed inset-y-0 start-0 z-50 flex h-full transition-transform duration-200 ease-out ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
          inert={!mobileOpen}
        >
          <ActivityBar />
          <ProjectPanel />
        </div>
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
        inert={!visible}
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
