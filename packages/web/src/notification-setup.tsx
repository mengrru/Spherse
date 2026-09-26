import { useEffect, useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import {
  needsNewSubscription,
  resolvePushSetupState,
  urlBase64ToUint8Array,
} from "@spherse/app/lib/notification-push";
import { readWebConnection } from "./host-bridge-web";

const DISMISS_KEY = "spherse:push-banner-dismissed";

function isPushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function subscriptionKeyBytes(subscription: PushSubscription): Uint8Array | null {
  const key = (subscription.options as { applicationServerKey?: ArrayBuffer | Uint8Array | string })
    .applicationServerKey;
  if (!key) return null;
  if (typeof key === "string") return urlBase64ToUint8Array(key);
  return new Uint8Array(key instanceof Uint8Array ? key : new Uint8Array(key as ArrayBuffer));
}

async function fetchPushPublicKey(baseUrl: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/api/connection/info`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { push?: { publicKey?: string } };
    return body.push?.publicKey ?? null;
  } catch {
    return null;
  }
}

async function subscribeAndReport(publicKeyBase64: string, locale: string): Promise<void> {
  const conn = readWebConnection();
  if (!conn?.baseUrl || !conn.token) return;
  const baseUrl = conn.baseUrl.replace(/\/+$/, "");
  const registration = await navigator.serviceWorker.ready;
  const expectedKeyBytes = urlBase64ToUint8Array(publicKeyBase64);
  const existing = await registration.pushManager.getSubscription();
  if (
    existing &&
    !needsNewSubscription({
      existingEndpoint: existing.endpoint,
      existingKeyBytes: subscriptionKeyBytes(existing),
      expectedKeyBytes,
    })
  ) {
    return;
  }
  if (existing) await existing.unsubscribe();
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: expectedKeyBytes,
  });
  await fetch(`${baseUrl}/api/push/subscribe`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${conn.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...subscription.toJSON(), locale }),
  });
}

export function NotificationSetupBanner() {
  const { t, locale } = useI18n();
  const [promptable, setPromptable] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) return;
    const conn = readWebConnection();
    if (!conn?.baseUrl || !conn.token) return;
    const baseUrl = conn.baseUrl.replace(/\/+$/, "");
    const token = conn.token;
    let cancelled = false;
    void (async () => {
      const publicKey = await fetchPushPublicKey(baseUrl, token);
      if (cancelled || !publicKey) return;
      const state = resolvePushSetupState({
        hasConnection: true,
        supported: true,
        pushAvailable: Boolean(publicKey),
        permission: Notification.permission,
      });
      if (state === "granted") {
        await subscribeAndReport(publicKey, locale);
        return;
      }
      if (
        state === "prompt" &&
        localStorage.getItem(DISMISS_KEY) !== "1"
      ) {
        setPromptable(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  if (!promptable) return null;

  const enable = async () => {
    setPromptable(false);
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;
    const conn = readWebConnection();
    if (!conn?.baseUrl || !conn.token) return;
    const publicKey = await fetchPushPublicKey(conn.baseUrl.replace(/\/+$/, ""), conn.token);
    if (!publicKey) return;
    await subscribeAndReport(publicKey, locale);
  };
  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setPromptable(false);
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2 text-sm">
      <div className="flex flex-col">
        <span className="font-medium leading-none">{t("web.enableNotifications")}</span>
        <span className="text-xs text-muted-foreground">{t("web.enableNotificationsHint")}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
          onClick={() => void enable()}
        >
          {t("web.enableNotifications")}
        </button>
        <button
          type="button"
          aria-label="dismiss"
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
          onClick={dismiss}
        >
          ×
        </button>
      </div>
    </div>
  );
}
