import type { LucideIcon } from "lucide-react";
import { ShieldCheck, Bot, Clock, Palette } from "lucide-react";
import { asset } from "@/lib/utils";

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
      asset("screenshots/features/local/1.png"),
    ],
  },
  {
    id: "agents",
    icon: Bot,
    i18nKeyPrefix: "feature.agents",
    screenshots: [
      asset("screenshots/features/agents/1.png"),
      asset("screenshots/features/agents/2.png"),
    ],
  },
  {
    id: "theme",
    icon: Palette,
    i18nKeyPrefix: "feature.theme",
    screenshots: [
      asset("screenshots/features/theme/1.png"),
      asset("screenshots/features/theme/2.png"),
    ],
  },
  {
    id: "trigger",
    icon: Clock,
    i18nKeyPrefix: "feature.trigger",
    screenshots: [
      asset("screenshots/features/trigger/1.png"),
      asset("screenshots/features/trigger/2.png"),
      asset("screenshots/features/trigger/3.png"),
    ],
  },
];
