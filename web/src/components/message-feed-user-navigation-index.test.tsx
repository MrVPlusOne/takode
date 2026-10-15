// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import type { ChatMessage } from "../types.js";

const searchSessionMessages = vi.hoisted(() =>
  vi.fn(async () => ({ results: [], hasMore: false, nextOffset: null, totalMatches: 0 })),
);
vi.mock("../api.js", () => ({ api: { searchSessionMessages } }));

import { useMessageFeedUserNavigationTargets } from "./message-feed-user-navigation-hook.js";

// The navigator's index lists the user messages typed in a session (plus starred replies).
// It is downloaded whole from the server (64 KB gzipped for a busy leader's Main thread), so
// it must be re-downloaded when a navigable user message arrives, not on every reply or
// worker event, which can never add a target.
const SESSION = "s-1";
// The store hands the hook the same starred map until starring changes.
const NO_STARS = {} as Record<string, never>;
const user = (id: string, agentSessionId?: string): ChatMessage => ({
  id,
  role: "user",
  content: id,
  timestamp: 1,
  ...(agentSessionId ? { agentSource: { sessionId: agentSessionId } } : {}),
});
const assistant = (id: string): ChatMessage => ({ id, role: "assistant", content: id, timestamp: 1 });

function renderTargets(initial: ChatMessage[]) {
  return renderHook(
    ({ allMessages, starredMessages }) =>
      useMessageFeedUserNavigationTargets({
        allMessages,
        isLeaderSession: false,
        normalizedThreadKey: "main",
        sessionId: SESSION,
        starredMessages,
        threadWindowRefreshRevision: 0,
        turns: [],
        userNavigationSourceSessionId: SESSION,
      }),
    { initialProps: { allMessages: initial, starredMessages: NO_STARS } },
  );
}

describe("user navigation index refresh", () => {
  beforeEach(() => searchSessionMessages.mockClear());

  it("refetches for a new user message but not for replies or worker events", async () => {
    const messages = [user("u-1"), assistant("a-1")];
    const { rerender } = renderTargets(messages);
    await waitFor(() => expect(searchSessionMessages).toHaveBeenCalledTimes(1));

    rerender({ allMessages: [...messages, assistant("a-2")], starredMessages: NO_STARS });
    rerender({ allMessages: [...messages, assistant("a-2"), user("herd-1", "worker")], starredMessages: NO_STARS });
    expect(searchSessionMessages).toHaveBeenCalledTimes(1);

    rerender({
      allMessages: [...messages, assistant("a-2"), user("herd-1", "worker"), user("u-2")],
      starredMessages: {},
    });
    await waitFor(() => expect(searchSessionMessages).toHaveBeenCalledTimes(2));
  });

  it("still refetches when a message is starred", async () => {
    const messages = [user("u-1"), assistant("a-1")];
    const { rerender } = renderTargets(messages);
    await waitFor(() => expect(searchSessionMessages).toHaveBeenCalledTimes(1));

    rerender({ allMessages: messages, starredMessages: { "a-1": { starredAt: 1 } } as never });
    await waitFor(() => expect(searchSessionMessages).toHaveBeenCalledTimes(2));
  });

  // Revisits refetch the index right after mount (the window refresh), which
  // used to abort the first read. An aborted read can drop the browser's cached
  // copy, so the next read downloaded the whole index again instead of a 304.
  // Same session and thread, even across a remount: the earlier read finishes;
  // a new thread: it is aborted.
  it("lets a same-thread read finish and aborts one for a thread left behind", async () => {
    // Reads stay open until the test ends, as on a slow link.
    const pending: Array<() => void> = [];
    const empty = { results: [], hasMore: false, nextOffset: null, totalMatches: 0 };
    searchSessionMessages.mockImplementation(() => new Promise((resolve) => pending.push(() => resolve(empty))));
    const signals = () =>
      (searchSessionMessages.mock.calls as unknown as Array<[string, { signal: AbortSignal }]>).map(
        ([, options]) => options.signal,
      );
    const messages = [user("u-1")];
    const { rerender, unmount } = renderHook(
      ({ threadKey, refresh }) =>
        useMessageFeedUserNavigationTargets({
          allMessages: messages,
          isLeaderSession: true,
          normalizedThreadKey: threadKey,
          sessionId: SESSION,
          starredMessages: NO_STARS,
          threadWindowRefreshRevision: refresh,
          turns: [],
          userNavigationSourceSessionId: SESSION,
        }),
      { initialProps: { threadKey: "main", refresh: 0 } },
    );
    await waitFor(() => expect(signals()).toHaveLength(1));

    rerender({ threadKey: "main", refresh: 1 });
    await waitFor(() => expect(signals()).toHaveLength(2));
    expect(signals()[0]!.aborted).toBe(false);

    rerender({ threadKey: "q-1", refresh: 1 });
    await waitFor(() => expect(signals()).toHaveLength(3));
    expect(signals()[1]!.aborted).toBe(true);

    // A remounted feed for the same thread keeps the read too.
    unmount();
    expect(signals()[2]!.aborted).toBe(false);
    for (const finish of pending) finish();
    searchSessionMessages.mockImplementation(async () => empty);
  });
});
