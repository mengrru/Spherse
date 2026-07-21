import { useSidePanel } from "../../hooks/use-side-panel";
import { ActivityBar } from "../activity-bar";
import { ProjectPanel } from "../project-panel";

export function SidePanel() {
  const { pinned, visible, show, hide, togglePin } = useSidePanel();

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
