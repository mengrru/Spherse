// Manages the carousel's theme stylesheet as a singleton <link> in <head>.
// Lifted out of the Carousel component so the active theme survives route
// changes (e.g. navigating to /explore keeps the theme that was cycling on home).

let linkEl: HTMLLinkElement | null = null;
let currentHref: string | null = null;

export function setCarouselTheme(href: string): void {
  if (currentHref === href && linkEl && document.head.contains(linkEl)) return;
  if (!linkEl) {
    linkEl = document.createElement("link");
    linkEl.rel = "stylesheet";
    document.head.appendChild(linkEl);
  }
  linkEl.href = href;
  currentHref = href;
}
