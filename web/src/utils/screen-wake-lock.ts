/**
 * Keeps the screen on until the returned release function is called.
 *
 * Voice recording holds this because a phone's auto-lock ends it: on iPhone, locking the
 * screen ends microphone capture, so anything said afterwards is lost.
 *
 * Browsers drop a screen wake lock whenever the page is hidden, so it is requested again each
 * time the page becomes visible while still held. WebKit grants a page its first wake lock only
 * during a user activation such as a tap, so call this from the tap that starts the work. Where
 * the API is missing (iPhone Home Screen apps before iOS 18.4) or refused, holding does nothing.
 */
export function holdScreenWakeLock(): () => void {
  const wakeLock: WakeLock | undefined = typeof navigator === "undefined" ? undefined : navigator.wakeLock;
  if (!wakeLock || typeof document === "undefined") return () => {};

  let held = true;
  let sentinel: WakeLockSentinel | null = null;
  let requesting = false;

  const request = () => {
    if (!held || requesting || (sentinel && !sentinel.released) || document.visibilityState !== "visible") return;
    requesting = true;
    wakeLock
      .request("screen")
      .then((lock) => {
        if (held) sentinel = lock;
        else void lock.release().catch(warnWakeLockFailure);
      }, warnWakeLockFailure)
      .finally(() => {
        requesting = false;
      });
  };

  document.addEventListener("visibilitychange", request);
  request();

  return () => {
    if (!held) return;
    held = false;
    document.removeEventListener("visibilitychange", request);
    void sentinel?.release().catch(warnWakeLockFailure);
    sentinel = null;
  };
}

function warnWakeLockFailure(error: unknown): void {
  console.warn("[screen-wake-lock] Could not keep the screen on:", error);
}
