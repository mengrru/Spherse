import { useHostBridge } from "../context/host-bridge-context";
import { FeatureGate } from "../components/FeatureGate";
import { OnboardingPage as OnboardingPageFeature } from "../features/onboarding/OnboardingPage";

export function OnboardingPage() {
  const bridge = useHostBridge();
  if (bridge.kind === "web" && bridge.renderConnectPage) {
    return <>{bridge.renderConnectPage()}</>;
  }
  return (
    <FeatureGate feature="open-project">
      <OnboardingPageFeature />
    </FeatureGate>
  );
}
