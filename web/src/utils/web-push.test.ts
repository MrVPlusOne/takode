// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATTENTION_OPEN_EVENT } from "./routing.js";
import { resumeWebPushOnThisDevice } from "./web-push.js";

vi.mock("../api.js", () => ({ api: { subscribeWebPush: vi.fn() } }));

/**
 * When Takode is already open, a tapped phone alert reaches the page as a
 * service-worker message rather than a page load. The page must follow the alert's
 * link in place, keeping its thread so the tap lands on the exact tab.
 */
describe("phone alert taps while Takode is open", () => {
  let serviceWorker: EventTarget & { startMessages: () => void; getRegistration: () => Promise<undefined> };

  beforeEach(() => {
    serviceWorker = Object.assign(new EventTarget(), {
      startMessages: vi.fn(),
      getRegistration: vi.fn(async () => undefined),
    });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("Notification", class {});
    window.location.hash = "#/session/other";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  function tapAlert(path: string) {
    serviceWorker.dispatchEvent(
      new MessageEvent("message", { data: { type: "takode-open-url", url: `${window.location.origin}${path}` } }),
    );
  }

  it("switches to the alert's session and thread", async () => {
    await resumeWebPushOnThisDevice();

    tapAlert("/#/session/leader?thread=q-7");

    expect(window.location.hash).toBe("#/session/leader?thread=q-7");
  });

  it("opens the attention list in place for a follow-up reminder", async () => {
    const opened = vi.fn();
    window.addEventListener(ATTENTION_OPEN_EVENT, opened);
    await resumeWebPushOnThisDevice();

    tapAlert("/#/attention");

    expect(opened).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#/session/other");
    window.removeEventListener(ATTENTION_OPEN_EVENT, opened);
  });
});
