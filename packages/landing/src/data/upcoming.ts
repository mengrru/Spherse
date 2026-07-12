import type { LucideIcon } from "lucide-react";
import { Brain, Smartphone } from "lucide-react";

export interface UpcomingFeature {
  id: "memory" | "mobile";
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
    id: "mobile",
    icon: Smartphone,
    i18nKeyPrefix: "upcoming.mobile",
  },
];
