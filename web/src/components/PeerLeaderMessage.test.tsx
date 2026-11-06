// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import type { ChatMessage, SessionState } from "../types.js";
import { useStore } from "../store.js";

const setMessageExpandedMock = vi.hoisted(() => vi.fn());
vi.mock("../api/message-expansion.js", () => ({ setMessageExpanded: setMessageExpandedMock }));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: {} }));

import { MessageBubble } from "./MessageBubble.js";

const FEED_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_LEADER_ID = "22222222-2222-4222-8222-222222222222";

function setFeedSession(isOrchestrator: boolean) {
  useStore.setState({
    sessions: new Map([[FEED_ID, { session_id: FEED_ID, isOrchestrator } as SessionState]]),
    sdkSessions: [],
  });
}

function peerMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "peer-1",
    role: "user",
    content:
      "Second awkward point for [q-12](quest:q-12): **categories** can't be archived.\n\nFull details follow here.",
    timestamp: Date.now(),
    agentSource: { sessionId: OTHER_LEADER_ID, sessionLabel: "#2957 Daily Leader" },
    ...overrides,
  };
}

describe("messages from other leaders", () => {
  beforeEach(() => {
    // Saving an expansion echoes it back the way the server does: as the session's state.
    setMessageExpandedMock.mockReset();
    setMessageExpandedMock.mockImplementation(async (sessionId: string, messageId: string, expanded: boolean) => {
      useStore.setState((state) => {
        const sessions = new Map(state.sessions);
        const session = sessions.get(sessionId)!;
        sessions.set(sessionId, { ...session, expandedMessages: expanded ? { [messageId]: Date.now() } : {} });
        return { sessions };
      });
    });
  });

  it("shows another leader's message in a leader's feed as one collapsed line that opens to the full text", () => {
    // The user's messages are hard to find among other leaders' messages when both are bubbles,
    // so another leader's message is a light line: sender plus the first line as plain text.
    setFeedSession(true);
    render(<MessageBubble message={peerMessage()} sessionId={FEED_ID} />);

    expect(screen.queryByTestId("user-message-bubble")).toBeNull();
    expect(screen.getByTestId("peer-leader-message-sender").textContent).toBe("#2957 Daily Leader");
    expect(screen.getByTestId("peer-leader-message-preview").textContent).toBe(
      "Second awkward point for q-12: categories can't be archived.",
    );
    expect(screen.queryByTestId("peer-leader-message-body")).toBeNull();

    fireEvent.click(screen.getByTestId("peer-leader-message-toggle"));

    // Expanding saves the session's expansion; once it comes back the full Markdown shows.
    expect(setMessageExpandedMock).toHaveBeenCalledWith(FEED_ID, "peer-1", true);
    return vi.waitFor(() => {
      expect(screen.getByTestId("peer-leader-message-body").textContent).toContain("Full details follow here.");
      expect(screen.queryByTestId("peer-leader-message-preview")).toBeNull();
    });
  });

  it("keeps the user's own messages and Takode's cron prompts as bubbles in a leader's feed", () => {
    setFeedSession(true);
    render(
      <>
        <MessageBubble message={peerMessage({ id: "own", agentSource: undefined })} sessionId={FEED_ID} />
        <MessageBubble
          message={peerMessage({ id: "cron", agentSource: { sessionId: "cron:digest", sessionLabel: "cron: Digest" } })}
          sessionId={FEED_ID}
        />
      </>,
    );

    expect(screen.getAllByTestId("user-message-bubble")).toHaveLength(2);
    expect(screen.queryByTestId("peer-leader-message")).toBeNull();
  });

  it("keeps a leader's instructions as a bubble in a worker's feed", () => {
    // In a worker's feed the leader's message is the request the worker acts on.
    setFeedSession(false);
    render(<MessageBubble message={peerMessage()} sessionId={FEED_ID} />);

    expect(screen.getByTestId("user-message-bubble")).toBeTruthy();
    expect(screen.queryByTestId("peer-leader-message")).toBeNull();
  });
});
