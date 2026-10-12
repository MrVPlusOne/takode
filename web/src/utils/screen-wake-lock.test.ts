// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdScreenWakeLock } from "./screen-wake-lock.js";

/** Minimal WakeLockSentinel: browsers flip `released` when they drop the lock on page hide. */
function makeSentinel() {
  const sentinel = {
    released: false,
    release: vi.fn(async () => {
      sentinel.released = true;
    }),
  };
  return sentinel;
}

/** Lets the pending request settle (it finishes over several promise reactions). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let sentinels: ReturnType<typeof makeSentinel>[];
let requestMock: ReturnType<typeof vi.fn>;
let visibility: DocumentVisibilityState;

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  sentinels = [];
  requestMock = vi.fn(async () => {
    const sentinel = makeSentinel();
    sentinels.push(sentinel);
    return sentinel;
  });
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: requestMock } });
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "wakeLock");
  Reflect.deleteProperty(document, "visibilityState");
  vi.restoreAllMocks();
});

describe("holdScreenWakeLock", () => {
  it("requests a screen lock immediately and releases it when done", async () => {
    // The request must start synchronously: WebKit only grants the first lock while the
    // starting tap is still a recent user activation.
    const release = holdScreenWakeLock();
    expect(requestMock).toHaveBeenCalledWith("screen");
    await flush();

    release();
    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
  });

  it("requests the lock again when the page returns after the browser dropped it", async () => {
    const release = holdScreenWakeLock();
    await flush();
    expect(requestMock).toHaveBeenCalledTimes(1);

    // Hiding the page drops the lock; no request is made while hidden.
    sentinels[0].released = true;
    setVisibility("hidden");
    expect(requestMock).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    expect(requestMock).toHaveBeenCalledTimes(2);

    await flush();
    release();
    expect(sentinels[1].release).toHaveBeenCalledTimes(1);
    // Once released, visibility changes no longer request a lock.
    setVisibility("hidden");
    setVisibility("visible");
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it("releases a lock that is granted only after the holder already let go", async () => {
    // Recording can end (e.g. a quick cancel) before the browser answers the request.
    let grant: (sentinel: ReturnType<typeof makeSentinel>) => void = () => {};
    requestMock.mockImplementationOnce(() => new Promise((resolve) => (grant = resolve)));
    const release = holdScreenWakeLock();
    release();

    const late = makeSentinel();
    grant(late);
    await vi.waitFor(() => expect(late.release).toHaveBeenCalledTimes(1));
  });

  it("does nothing where the Screen Wake Lock API is missing", () => {
    Reflect.deleteProperty(navigator, "wakeLock");
    const release = holdScreenWakeLock();
    expect(() => release()).not.toThrow();
  });

  it("logs and carries on when the browser refuses the lock", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    requestMock.mockRejectedValueOnce(new DOMException("Permission was denied", "NotAllowedError"));
    const release = holdScreenWakeLock();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(() => release()).not.toThrow();
  });
});
