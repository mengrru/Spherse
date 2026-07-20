import { useHostBridge } from "../context/host-bridge-context";
import { isFeatureEnabled, type FeatureName } from "./feature-registry";

export function useFeature(feature: FeatureName): boolean {
  const { kind } = useHostBridge();
  return isFeatureEnabled(feature, kind);
}
