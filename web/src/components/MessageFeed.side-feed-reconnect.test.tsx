// @vitest-environment jsdom
// A side feed that has no window yet asks for one again when its session's connection comes back.
import { render } from "@testing-library/react";
import {
  installSectionWindowingTestHooks,
  mockSendToSession,
  setStoreConnectionStatus,
  setStoreMessages,
  setStoreSessionState,
  setStoreThreadWindowRevisions,
  flushFeedObservers,
} from "./MessageFeed.section-windowing.test-harness.js";

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: {} }));
vi.mock("../ws.js", async () => (await import("./MessageFeed.section-windowing.test-harness.js")).mockWsModule());
vi.mock("../api.js", async () => (await import("./MessageFeed.section-windowing.test-harness.js")).mockApiModule());
vi.mock("../store.js", async () => (await import("./MessageFeed.section-windowing.test-harness.js")).mockStoreModule());

import { MessageFeed } from "./MessageFeed.js";
import { makeMessage } from "./MessageFeed.messagefeed-section-windowing.test-helpers.js";
import { SecondaryFeedContext } from "./secondary-feed.js";

installSectionWindowingTestHooks();

describe("side feed window after a reconnect", () => {
  it("asks again for a window its first request could not send", async () => {
    // A side chat opened in the same commit that switched the main view to its leader: child
    // effects run before the app's, so its request went out while the leader had no socket and
    // was dropped. The switch then reused an open socket, so the connection status went
    // connecting -> connected within one task and the feed saw no change; only the session's
    // window refresh revision moved. The chat showed "Loading conversation..." forever.
    const sid = "test-side-feed-reconnect";
    setStoreSessionState(sid, { isOrchestrator: true });
    setStoreConnectionStatus(sid, "connected");
    // The main view's conversation of the same leader is loaded; this thread's window is not.
    setStoreMessages(sid, [makeMessage({ id: "m1", role: "user", content: "Main view request" })]);
    mockSendToSession.mockImplementation(() => false);

    const side = () => (
      <SecondaryFeedContext.Provider value="side-feed">
        <MessageFeed sessionId={sid} threadKey="q-3" />
      </SecondaryFeedContext.Provider>
    );
    const { rerender, getByText } = render(side());
    await flushFeedObservers();
    expect(getByText("Loading conversation...")).toBeTruthy();

    // The leader's socket opens: onConnected marks the session's windows stale.
    mockSendToSession.mockClear();
    mockSendToSession.mockImplementation(() => true);
    setStoreThreadWindowRevisions({ sessionId: sid, threadKey: "q-3", refreshRevision: 1, appliedRevision: 0 });
    rerender(side());
    await flushFeedObservers();

    expect(mockSendToSession).toHaveBeenCalledWith(
      sid,
      expect.objectContaining({ type: "thread_window_request", thread_key: "q-3", activate_view: false }),
    );
  });
});
