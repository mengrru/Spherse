import type { LucideIcon } from "lucide-react";
import { Brain, Plug, Smartphone } from "lucide-react";

export interface UpcomingFeature {
  id: "memory" | "mobile" | "connector";
  icon: LucideIcon;
  i18nKeyPrefix: string;
}

export const upcomingFeatures: UpcomingFeature[] = [
  {
    id: "memory",
    icon: Brain,
    i18nKeyPrefix: "upcoming.memory",
  },
  {
    id: "connector",
    icon: Plug,
    i18nKeyPrefix: "upcoming.connector",
  },
  {
    id: "mobile",
    icon: Smartphone,
    i18nKeyPrefix: "upcoming.mobile",
  },
];
