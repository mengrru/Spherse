import type { ReactNode } from "react";
import { useFeature } from "../lib/use-feature";
import type { FeatureName } from "../lib/feature-registry";

interface FeatureGateProps {
  feature: FeatureName;
  children: ReactNode;
  fallback?: ReactNode;
}

export function FeatureGate({ feature, children, fallback = null }: FeatureGateProps) {
  const enabled = useFeature(feature);
  return enabled ? <>{children}</> : <>{fallback}</>;
}
