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
});
