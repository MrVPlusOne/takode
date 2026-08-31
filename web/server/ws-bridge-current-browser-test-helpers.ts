import { vi } from "vitest";

export const CURRENT_SESSION_SUBSCRIBE = JSON.stringify({
  type: "session_subscribe",
  last_seq: 0,
  history_window_section_turn_count: 10,
  history_window_visible_section_count: 3,
});

type BrowserSendMock = {
  mock: { calls: unknown[][] };
  mockClear: () => void;
};

export async function waitForBrowserMessage(
  browser: { send: BrowserSendMock },
  predicate: (message: any) => boolean,
  timeout = 5_000,
): Promise<any> {
  let match: any;
  await vi.waitFor(
    () => {
      match = browser.send.mock.calls.map((call) => JSON.parse(String(call[0]))).find(predicate);
      if (!match) throw new Error("Expected browser message has not arrived");
    },
    { timeout, interval: 1 },
  );
  return match;
}

/** Establish a current-build bounded browser view, settle its bootstrap sends, then reset observations. */
export async function subscribeCurrentBrowser(
  bridge: { handleBrowserMessage: (browser: any, raw: string) => void },
  browser: { send: BrowserSendMock },
): Promise<void> {
  bridge.handleBrowserMessage(browser, CURRENT_SESSION_SUBSCRIBE);
  await waitForBrowserMessage(browser, (message) => message.type === "state_snapshot");
  browser.send.mockClear();
}

/** Establish the bounded view synchronously when fake timers make flushes unsafe. */
export function subscribeCurrentBrowserWithoutFlush(
  bridge: { handleBrowserMessage: (browser: any, raw: string) => void },
  browser: { send: { mockClear: () => void } },
): void {
  bridge.handleBrowserMessage(browser, CURRENT_SESSION_SUBSCRIBE);
  browser.send.mockClear();
}
