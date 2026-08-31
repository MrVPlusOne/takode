export const CURRENT_SESSION_SUBSCRIBE = JSON.stringify({
  type: "session_subscribe",
  last_seq: 0,
  history_window_section_turn_count: 10,
  history_window_visible_section_count: 3,
});

/** Establish a current-build bounded browser view, settle its bootstrap sends, then reset observations. */
export async function subscribeCurrentBrowser(
  bridge: { handleBrowserMessage: (browser: any, raw: string) => void },
  browser: { send: { mockClear: () => void } },
): Promise<void> {
  bridge.handleBrowserMessage(browser, CURRENT_SESSION_SUBSCRIBE);
  for (let pass = 0; pass < 3; pass++) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
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
