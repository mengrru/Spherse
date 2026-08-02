import type { LucideIcon } from "lucide-react";
import {
  Bot,
  FolderOpen,
  PackageOpen,
  PanelsTopLeft,
  Smartphone,
  Workflow,
} from "lucide-react";
import { asset } from "@/lib/utils";

export interface Feature {
  id: "workspace" | "agents" | "automation" | "apps" | "portable" | "mobile";
  icon: LucideIcon;
  i18nKeyPrefix: string;
  screenshots: string[];
}

export const features: Feature[] = [
  {
    id: "workspace",
    icon: FolderOpen,
    i18nKeyPrefix: "feature.workspace",
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
    id: "automation",
    icon: Workflow,
    i18nKeyPrefix: "feature.automation",
    screenshots: [
      asset("screenshots/features/trigger/1.png"),
      asset("screenshots/features/trigger/2.png"),
      asset("screenshots/features/trigger/3.png"),
    ],
  },
  {
    id: "apps",
    icon: PanelsTopLeft,
    i18nKeyPrefix: "feature.apps",
    screenshots: [
      asset("screenshots/features/theme/1.png"),
      asset("screenshots/features/theme/2.png"),
    ],
  },
  {
    id: "portable",
    icon: PackageOpen,
    i18nKeyPrefix: "feature.portable",
    screenshots: [],
  },
  {
    id: "mobile",
    icon: Smartphone,
    i18nKeyPrefix: "feature.mobile",
    screenshots: [],
  },
];
