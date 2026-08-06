// @vitest-environment jsdom
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ChatMessage } from "../types.js";

const unstarMessageMock = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("../api.js", () => ({
  api: {
    revertToMessage: vi.fn(async () => ({})),
    starMessage: vi.fn(async () => ({})),
    unstarMessage: unstarMessageMock,
    markNotificationDone: vi.fn(async () => ({})),
    getFsImageUrl: (path: string) => `/api/fs/image?path=${encodeURIComponent(path)}`,
  },
}));

vi.mock("react-markdown", () => ({
  default: ({
    children,
    components,
  }: {
    children: string;
    components?: { p?: (props: { children: string }) => ReactNode };
  }) => {
    if (components?.p) return <div data-testid="markdown">{components.p({ children })}</div>;
    return <div data-testid="markdown">{children}</div>;
  },
}));

vi.mock("remark-gfm", () => ({ default: {} }));

import { MessageBubble } from "./MessageBubble.js";
import { formatExactMessageTimestamp } from "./MessageTimestamp.js";
import { useStore } from "../store.js";

function makeMessage(overrides: Partial<ChatMessage> & { role: ChatMessage["role"] }): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    content: "",
    timestamp: Date.now(),
    ...overrides,
  };
}

function setStarredMessage(message: ChatMessage, sessionId = "star-session") {
  useStore.setState({
    sessions: new Map([
      [
        sessionId,
        {
          session_id: sessionId,
          starredMessages: {
            [message.id]: {
              messageId: message.id,
              role: message.role,
              historyIndex: message.historyIndex ?? 1,
              sourceThreadKey: "main",
              routeThreadKey: "main",
              timestamp: message.timestamp,
              starredAt: message.timestamp + 1,
            },
          },
        } as any,
      ],
    ]),
  });
}

describe("MessageBubble timestamp menu affordances", () => {
  beforeEach(() => {
    unstarMessageMock.mockClear();
    useStore.setState({
      sessions: new Map(),
      quests: [],
      questDetails: new Map(),
      questDetailEtags: new Map(),
      compactToolActivity: false,
    });
  });

  it("shows the exact stored time from the ordinary user message menu trigger", () => {
    // User rows should use the existing right-side menu trigger, not a new assistant-style rail dot.
    const ts = new Date(2026, 6, 25, 17, 22, 13).getTime();
    const msg = makeMessage({ id: "user-time-menu", role: "user", content: "With menu timestamp", timestamp: ts });
    render(<MessageBubble message={msg} />);

    expect(screen.queryByTestId("message-time-user-rail")).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId("message-time-user-menu"));

    expect(screen.getByRole("tooltip").textContent).toContain(formatExactMessageTimestamp(ts));
  });

  it("shows an unavailable menu timestamp state instead of guessing from an invalid stored time", () => {
    // Invalid timestamps keep the menu affordance truthful without restoring a rail marker.
    const msg = makeMessage({ id: "user-time-invalid", role: "user", content: "Bad timestamp", timestamp: Number.NaN });
    render(<MessageBubble message={msg} />);

    expect(screen.queryByTestId("message-timestamp")).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId("message-time-user-menu"));

    expect(screen.getByRole("tooltip").textContent).toContain("Time unavailable");
    expect(screen.queryByTestId("message-time-user-rail")).toBeNull();
  });

  it("preserves the user message menu click action while closing the timestamp tooltip", () => {
    // Hover/focus is timestamp inspection; click still opens the normal message options menu.
    const ts = new Date(2026, 6, 25, 17, 22, 13).getTime();
    const msg = makeMessage({ id: "user-time-click", role: "user", content: "Open options", timestamp: ts });
    render(<MessageBubble message={msg} sessionId="menu-session" />);

    const trigger = screen.getByTestId("message-time-user-menu");
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole("tooltip").textContent).toContain(formatExactMessageTimestamp(ts));

    fireEvent.click(trigger);

    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.getByText("Copy message")).toBeTruthy();
  });

  it("keeps starred user rail markers as unstar controls instead of timestamp triggers", () => {
    // The side rail star remains actionable, but timestamp inspection moves to the message menu.
    const ts = new Date(2026, 6, 25, 17, 22, 13).getTime();
    const msg = makeMessage({
      id: "user-star-menu",
      role: "user",
      content: "Quick unstar",
      timestamp: ts,
      historyIndex: 3,
    });
    setStarredMessage(msg);
    render(<MessageBubble message={msg} sessionId="star-session" />);

    const rail = screen.getByTestId("starred-message-user-rail");
    fireEvent.mouseEnter(rail);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.click(rail);
    fireEvent.click(screen.getByText("Unstar message"));

    expect(unstarMessageMock).toHaveBeenCalledWith("star-session", "user-star-menu");
  });

  it("shows exact timestamp details from the assistant message menu trigger on focus", () => {
    // Assistant rows keep their leading paw/star rail visuals, but the menu trigger owns the timestamp popover.
    const ts = new Date(2026, 6, 25, 17, 22, 13).getTime();
    const msg = makeMessage({
      id: "assistant-time-menu",
      role: "assistant",
      content: "Timed response",
      timestamp: ts,
      historyIndex: 4,
    });
    render(<MessageBubble message={msg} />);

    expect(screen.queryByTestId("message-time-assistant-rail")).toBeNull();
    fireEvent.focus(screen.getByTestId("message-time-assistant-menu"));

    expect(screen.getByRole("tooltip").textContent).toContain(formatExactMessageTimestamp(ts));
  });

  it("keeps starred assistant rail markers as unstar controls while the menu trigger shows time", () => {
    // Starred assistant rail clicks still open Unstar; timestamp details come from the right-side menu.
    const ts = new Date(2026, 6, 25, 17, 22, 13).getTime();
    const msg = makeMessage({
      id: "assistant-starred-time-menu",
      role: "assistant",
      content: "Save this answer",
      timestamp: ts,
      historyIndex: 4,
    });
    setStarredMessage(msg);
    render(<MessageBubble message={msg} sessionId="star-session" />);

    const rail = screen.getByTestId("starred-message-assistant-rail");
    fireEvent.focus(rail);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.focus(screen.getByTestId("message-time-assistant-menu"));
    expect(screen.getByRole("tooltip").textContent).toContain(formatExactMessageTimestamp(ts));

    fireEvent.click(rail);
    fireEvent.click(screen.getByText("Unstar message"));

    expect(unstarMessageMock).toHaveBeenCalledWith("star-session", "assistant-starred-time-menu");
  });
});
