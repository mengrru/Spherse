import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { slides } from "../data/slides";
import { setCarouselTheme } from "../lib/carousel-theme";
import { cn } from "../lib/utils";

const AUTOPLAY_INTERVAL = 5000;

const ANCHOR = {
  left: "0.45cqw",
  top: "0.4cqw",
  size: "2.5cqw",
  gap: "0.49cqw",
  glowBlur: "0.56cqw",
  glowSpread: "0.14cqw",
  glowInset: "0.14cqw",
} as const;

export function Carousel() {
  const [activeIndex, setActiveIndex] = useState(() => Math.floor(Math.random() * slides.length));
  const [autoplay, setAutoplay] = useState(true);
  const initialIndexRef = useRef(activeIndex);

  const goToSlide = useCallback((index: number) => {
    const next = ((index % slides.length) + slides.length) % slides.length;
    setActiveIndex(next);
    setCarouselTheme(slides[next].theme);
  }, []);

  // Apply the initial theme on mount. The <link> is a singleton managed by
  // carousel-theme.ts and intentionally NOT removed on unmount, so the active
  // theme persists when navigating away (e.g. to /explore).
  useEffect(() => {
    setCarouselTheme(slides[initialIndexRef.current].theme);
  }, []);

  // Autoplay: timer restarts whenever activeIndex changes (autoplay tick or user click)
  useEffect(() => {
    if (!autoplay) return;
    const timer = setTimeout(() => {
      const next = (activeIndex + 1) % slides.length;
      setActiveIndex(next);
      setCarouselTheme(slides[next].theme);
    }, AUTOPLAY_INTERVAL);
    return () => clearTimeout(timer);
  }, [activeIndex, autoplay]);

  const handleAnchorClick = (index: number) => {
    goToSlide(index);
  };

  return (
    <section className="px-6 py-8">
      <div className="relative mx-auto max-w-[1400px]">
        {/*
          Grid columns sized by each screenshot's aspect ratio (desktop 16/10, mobile 1206/2622).
          Since grid tracks divide width proportionally and each cell's height is derived from
          its aspect-ratio, both columns end up with equal height.
        */}
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: "1.6fr 0.46fr" }}
        >
          {/* Desktop screenshot column — establishes container context for anchor positioning (cqw) */}
          <div
            className="relative aspect-[16/10] overflow-hidden rounded-lg border border-border shadow-sm"
            style={{ containerType: "inline-size" }}
          >
            {slides.map((slide, idx) => (
              <img
                key={idx}
                src={slide.screenshot}
                alt={`Screenshot ${idx + 1}`}
                className={cn(
                  "absolute inset-0 h-full w-full object-cover object-bottom transition-opacity duration-500",
                  idx === activeIndex ? "opacity-100" : "opacity-0",
                )}
                loading={idx === 0 ? "eager" : "lazy"}
              />
            ))}

            {/* Anchor buttons — positioned with relative units (cqw) to align with avatar at any carousel size */}
            <div
              className="absolute flex flex-col"
              style={{ top: ANCHOR.top, left: ANCHOR.left, gap: ANCHOR.gap }}
            >
              {slides.map((slide, idx) => {
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={idx}
                    onClick={() => handleAnchorClick(idx)}
                    aria-label={`Go to slide ${idx + 1}`}
                    className={cn(
                      "rounded-lg transition-all duration-200",
                      isActive ? "opacity-100" : "opacity-0 hover:opacity-30",
                    )}
                    style={{
                      width: ANCHOR.size,
                      aspectRatio: "1",
                      boxShadow: isActive
                        ? `0 0 ${ANCHOR.glowBlur} ${ANCHOR.glowSpread} ${slide.avatarColor}, inset 0 0 0 ${ANCHOR.glowInset} ${slide.avatarColor}`
                        : "none",
                    }}
                  >
                    <span className="sr-only">{slide.avatarLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mobile screenshot column — natural phone aspect ratio */}
          <div className="relative aspect-[1206/2622] overflow-hidden rounded-lg border border-border shadow-sm">
            {slides.map((slide, idx) => (
              <img
                key={idx}
                src={slide.mobileScreenshot}
                alt={`Mobile screenshot ${idx + 1}`}
                className={cn(
                  "absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-500",
                  idx === activeIndex ? "opacity-100" : "opacity-0",
                )}
                loading="lazy"
              />
            ))}
          </div>
        </div>

        {/* Autoplay toggle */}
        <button
          onClick={() => setAutoplay((v) => !v)}
          aria-label={autoplay ? "Pause autoplay" : "Play autoplay"}
          className="absolute top-4 right-4 z-10 flex size-9 items-center justify-center rounded-lg bg-background/80 text-foreground backdrop-blur-sm transition-colors hover:bg-background"
        >
          {autoplay ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
      </div>
    </section>
  );
}
