import { FloatingChatManager } from "../features/floating-chat";
import { FloatingContentBrowserManager } from "../features/floating-content-browser";
import { BrowserManager } from "../features/browser";
import { TriggerEventBridge } from "../features/agent-trigger";
import { FeatureGate } from "../components/FeatureGate";
import { UiSdkBridge } from "../ui-sdk";
import { ContentQueryBridge } from "../features/content-browser/ContentQueryBridge";
import { ThemeQueryBridge } from "../features/project-settings/theme-settings/ThemeQueryBridge";
import { WelcomePageQueryBridge } from "../features/welcome-page/WelcomePageQueryBridge";

export function ProjectRuntimeBridges() {
  return (
    <>
      <FeatureGate feature="floating-chat">
        <FloatingChatManager />
      </FeatureGate>
      <FeatureGate feature="floating-content-browser">
        <FloatingContentBrowserManager />
      </FeatureGate>
      <FeatureGate feature="browser">
        <BrowserManager />
      </FeatureGate>
      <UiSdkBridge />
      <TriggerEventBridge />
      <ContentQueryBridge />
      <ThemeQueryBridge />
      <WelcomePageQueryBridge />
    </>
  );
}
