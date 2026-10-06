import { type ComponentProps, useEffect, useState } from "react";
import { api } from "../api.js";
import { disableWebPush, enableWebPush, getWebPushSupport, registerTakodeServiceWorker } from "../utils/web-push.js";
import { CollapsibleSection } from "./CollapsibleSection.js";

type SectionSearchProps = Pick<ComponentProps<typeof CollapsibleSection>, "hidden" | "searchQuery" | "matchCount">;

/** Seconds before the Settings test notification retracts itself, exercising retraction on the device. */
const TEST_RETRACT_AFTER_SECONDS = 20;

/**
 * Per-device Web Push enrollment. Delay and event types are shared with the
 * Pushover section because both channels are driven by the same alert scheduler.
 */
export function SettingsWebPushSection({ sectionSearchProps }: { sectionSearchProps: SectionSearchProps }) {
  const support = getWebPushSupport();
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [serverAvailable, setServerAvailable] = useState(true);
  const [deviceCount, setDeviceCount] = useState(0);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api
      .getWebPushInfo()
      .then((info) => {
        setServerAvailable(info.available);
        setPublicKey(info.publicKey);
        setDeviceCount(info.subscriptionCount);
      })
      .catch(() => setServerAvailable(false));
    if (support !== "supported") return;
    // Registered up front so the Enable tap can call subscribe() without awaiting first.
    registerTakodeServiceWorker()
      .then(async (reg) => {
        setRegistration(reg);
        setSubscription(await reg.pushManager.getSubscription());
      })
      .catch((error) => setStatus({ ok: false, text: `Service worker failed: ${errorText(error)}` }));
  }, [support]);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setStatus(null);
    try {
      setStatus({ ok: true, text: await action() });
    } catch (error) {
      setStatus({ ok: false, text: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  function onEnable() {
    if (!registration || !publicKey) return;
    void run(async () => {
      const result = await enableWebPush(registration, publicKey);
      setSubscription(result.subscription);
      setDeviceCount(result.subscriptionCount);
      return "Notifications enabled on this device.";
    });
  }

  function onDisable() {
    if (!subscription) return;
    void run(async () => {
      setDeviceCount(await disableWebPush(subscription));
      setSubscription(null);
      return "Notifications disabled on this device.";
    });
  }

  function onTest() {
    if (!subscription) return;
    void run(async () => {
      await api.testWebPush(subscription.endpoint, TEST_RETRACT_AFTER_SECONDS);
      return `Test sent. It should disappear about ${TEST_RETRACT_AFTER_SECONDS}s after it arrives.`;
    });
  }

  const permissionDenied = support === "supported" && Notification.permission === "denied";

  return (
    <CollapsibleSection
      id="web-push"
      title="Phone Notifications (Web Push)"
      description="Alerts on this device through the browser, with no third-party app. Answered questions are removed from the phone."
      {...sectionSearchProps}
    >
      <p className="text-xs text-cc-muted">
        Uses the delay and event types from the Pushover section. Alerts are skipped while Takode is open on the device
        itself.
      </p>

      {!serverAvailable && <Notice tone="error">Web Push is unavailable on this server (see server log).</Notice>}
      {support === "needs-home-screen" && (
        <Notice tone="muted">
          On iPhone, add Takode to your Home Screen (Share, then Add to Home Screen) and open it from there to enable
          notifications.
        </Notice>
      )}
      {support === "unsupported" && <Notice tone="muted">This browser does not support Web Push.</Notice>}
      {permissionDenied && (
        <Notice tone="error">
          Notifications are blocked for Takode. Allow them in the device settings, then retry.
        </Notice>
      )}

      {status && <Notice tone={status.ok ? "success" : "error"}>{status.text}</Notice>}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-cc-muted">
          {subscription ? "Enabled on this device" : "Not enabled on this device"}
          {` · ${deviceCount} device${deviceCount === 1 ? "" : "s"} subscribed`}
        </span>
        {support === "supported" && serverAvailable && (
          <div className="flex items-center gap-2">
            {subscription && (
              <button
                type="button"
                onClick={onTest}
                disabled={busy}
                className="px-2.5 py-1 rounded text-xs font-medium bg-cc-hover text-cc-fg hover:bg-cc-active cursor-pointer disabled:cursor-not-allowed disabled:text-cc-muted"
              >
                Send Test
              </button>
            )}
            <button
              type="button"
              onClick={subscription ? onDisable : onEnable}
              disabled={busy || (!subscription && (!registration || !publicKey))}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer disabled:cursor-not-allowed disabled:bg-cc-hover disabled:text-cc-muted"
            >
              {subscription ? "Disable on this device" : "Enable on this device"}
            </button>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}

function Notice({ tone, children }: { tone: "error" | "success" | "muted"; children: React.ReactNode }) {
  const toneClass =
    tone === "error"
      ? "bg-cc-error/10 border-cc-error/20 text-cc-error"
      : tone === "success"
        ? "bg-cc-success/10 border-cc-success/20 text-cc-success"
        : "bg-cc-hover border-cc-border text-cc-muted";
  return <div className={`px-3 py-2 rounded-lg border text-xs ${toneClass}`}>{children}</div>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
