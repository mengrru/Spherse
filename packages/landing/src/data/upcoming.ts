import type { LucideIcon } from "lucide-react";
import { BookOpen, Users } from "lucide-react";

export interface UpcomingFeature {
  id: "worldbook" | "roundtable";
  icon: LucideIcon;
  i18nKeyPrefix: string;
}

export const upcomingFeatures: UpcomingFeature[] = [
  {
    id: "worldbook",
    icon: BookOpen,
    i18nKeyPrefix: "upcoming.worldbook",
  },
  {
    id: "roundtable",
    icon: Users,
    i18nKeyPrefix: "upcoming.roundtable",
  },
];
