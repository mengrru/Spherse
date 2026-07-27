import { asset } from "@/lib/utils";

export interface Slide {
  screenshot: string;
  mobileScreenshot: string;
  theme: string;
  avatarColor: string;
  avatarLabel: string;
}

export const slides: Slide[] = [
  {
    screenshot: asset("screenshots/carousel-1.png"),
    mobileScreenshot: asset("screenshots/carousel-mobile-1.png"),
    theme: asset("themes/screenshot-1.css"),
    avatarColor: "hsl(0, 0%, 25%)",
    avatarLabel: "H",
  },
  {
    screenshot: asset("screenshots/carousel-2.png"),
    mobileScreenshot: asset("screenshots/carousel-mobile-2.png"),
    theme: asset("themes/screenshot-2.css"),
    avatarColor: "hsl(0, 55%, 40%)",
    avatarLabel: "R",
  },
  {
    screenshot: asset("screenshots/carousel-3.png"),
    mobileScreenshot: asset("screenshots/carousel-mobile-3.png"),
    theme: asset("themes/screenshot-3.css"),
    avatarColor: "#ff2d95",
    avatarLabel: "F",
  },
  {
    screenshot: asset("screenshots/carousel-4.png"),
    mobileScreenshot: asset("screenshots/carousel-mobile-4.png"),
    theme: asset("themes/screenshot-4.css"),
    avatarColor: "#4e7638",
    avatarLabel: "M",
  },
];
