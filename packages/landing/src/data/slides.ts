export interface Slide {
  screenshot: string;
  theme: string;
  avatarColor: string;
  avatarLabel: string;
}

export const slides: Slide[] = [
  {
    screenshot: "/Spherse/screenshots/carousel-1.png",
    theme: "/Spherse/themes/screenshot-1.css",
    avatarColor: "hsl(0, 0%, 25%)",
    avatarLabel: "H",
  },
  {
    screenshot: "/Spherse/screenshots/carousel-2.png",
    theme: "/Spherse/themes/screenshot-2.css",
    avatarColor: "hsl(0, 55%, 40%)",
    avatarLabel: "R",
  },
  {
    screenshot: "/Spherse/screenshots/carousel-3.png",
    theme: "/Spherse/themes/screenshot-3.css",
    avatarColor: "#ff2d95",
    avatarLabel: "F",
  },
];
