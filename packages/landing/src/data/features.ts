import type { LucideIcon } from "lucide-react";
import { ShieldCheck, Bot, Clock, Palette } from "lucide-react";

export interface Feature {
  id: "local" | "agents" | "trigger" | "theme";
  icon: LucideIcon;
  i18nKeyPrefix: string;
  screenshots: string[];
}

export const features: Feature[] = [
  {
    id: "local",
    icon: ShieldCheck,
    i18nKeyPrefix: "feature.local",
    screenshots: [
      "/Spherse/screenshots/features/local/1.png",
    ],
  },
  {
    id: "agents",
    icon: Bot,
    i18nKeyPrefix: "feature.agents",
    screenshots: [
      "/Spherse/screenshots/features/agents/1.png",
      "/Spherse/screenshots/features/agents/2.png",
    ],
  },
  {
    id: "theme",
    icon: Palette,
    i18nKeyPrefix: "feature.theme",
    screenshots: [
      "/Spherse/screenshots/features/theme/1.png",
      "/Spherse/screenshots/features/theme/2.png",
    ],
  },
  {
    id: "trigger",
    icon: Clock,
    i18nKeyPrefix: "feature.trigger",
    screenshots: [
      "/Spherse/screenshots/features/trigger/1.png",
      "/Spherse/screenshots/features/trigger/2.png",
      "/Spherse/screenshots/features/trigger/3.png",
    ],
  },
];
