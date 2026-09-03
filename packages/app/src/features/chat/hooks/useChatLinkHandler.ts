import { useCallback } from "react";

export function useChatLinkHandler(openLink: (href: string) => void) {
  return useCallback(
    async (href: string, event: React.MouseEvent<HTMLAnchorElement>) => {
      if (!href) return;
      event.preventDefault();
      if (href.startsWith("#")) {
        if (href.length > 1) {
          document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
      }
      openLink(href);
    },
    [openLink],
  );
}
