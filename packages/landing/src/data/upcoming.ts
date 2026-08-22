import type { LucideIcon } from "lucide-react";
import { Brain, Users } from "lucide-react";

export interface UpcomingFeature {
  id: "memory" | "roundtable";
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
    id: "roundtable",
    icon: Users,
    i18nKeyPrefix: "upcoming.roundtable",
  },
];
