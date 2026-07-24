import type { LucideIcon } from "lucide-react";
import { Brain } from "lucide-react";

export interface UpcomingFeature {
  id: "memory";
  icon: LucideIcon;
  i18nKeyPrefix: string;
}

export const upcomingFeatures: UpcomingFeature[] = [
  {
    id: "memory",
    icon: Brain,
    i18nKeyPrefix: "upcoming.memory",
  },
];
