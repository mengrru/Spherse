import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import {
  compareAppVersion,
  type AppVersionCompatibility,
} from "@spherse/app/src/lib/version-compat";
import { DEFAULT_LOCALE, translate } from "@spherse/i18n";
import { useSettingsStore } from "@spherse/app/src/stores/settings-store";
import { readWebConnection } from "./host-bridge-web";
import { VersionBlockOverlay } from "./version-block-overlay";

declare const __SPHERSE_WEB_VERSION__: string;

function currentLocale() {
  return useSettingsStore.getState().locale ?? DEFAULT_LOCALE;
}

let overlayHost: HTMLDivElement | null = null;
let overlayRoot: Root | null = null;
let overlayDismissed = false;
let pendingOnDismiss: (() => void) | null = null;
let lastNotified: AppVersionCompatibility | null = null;

// 「暂不升级，继续使用」：仅本次会话生效，刷新页面后重新检测
function dismissVersionBlock(): void {
  overlayDismissed = true;
  overlayRoot?.unmount();
  overlayHost?.remove();
  overlayHost = null;
  overlayRoot = null;
  const callback = pendingOnDismiss;
  pendingOnDismiss = null;
  callback?.();
}

function mountVersionBlock(appVersion: string, onDismiss?: () => void): void {
  if (overlayHost || overlayDismissed) return;
  pendingOnDismiss = onDismiss ?? null;
  overlayHost = document.createElement("div");
  overlayHost.dataset.spherseVersionBlock = "";
  document.body.appendChild(overlayHost);
  overlayRoot = createRoot(overlayHost);
  overlayRoot.render(
    <VersionBlockOverlay appVersion={appVersion} onDismiss={dismissVersionBlock} />,
  );
}

export async function runWebVersionGuard(
  onDismiss?: () => void,
): Promise<AppVersionCompatibility> {
  const conn = readWebConnection();
  if (!conn?.baseUrl) return "ok";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const base = conn.baseUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}/api/connection/info`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return "ok";
    const body = (await res.json()) as { appVersion?: string | null };
    const appVersion = body.appVersion ?? null;
    const result = compareAppVersion(appVersion, __SPHERSE_WEB_VERSION__);
    if (result === "incompatible") {
      mountVersionBlock(appVersion ?? "", onDismiss);
      return result;
    }
    if (result === lastNotified) return result;
    lastNotified = result;
    if (result === "patch-mismatch") {
      toast.warning(
        translate(currentLocale(), "web-version.patchWarning", {
          appVersion: appVersion ?? "",
          webVersion: __SPHERSE_WEB_VERSION__,
        }),
      );
    } else if (result === "unknown") {
      toast.warning(translate(currentLocale(), "web-version.unknownWarning"));
    }
    return result;
  } catch {
    return "ok";
  }
}
