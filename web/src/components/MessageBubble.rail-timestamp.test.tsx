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
import { normalizeHistoryMessageToChatMessages } from "../utils/history-message-normalization.js";
import type { BrowserIncomingMessage } from "../types.js";

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

describe("MessageBubble rail timestamp affordances", () => {
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

  it("shows the exact stored time from the ordinary user rail marker", () => {
    // Stable user rows get a rail timestamp affordance even when they are not starred.
    const ts = new Date(2026, 6, 25, 17, 22, 13).getTime();
    const msg = makeMessage({ id: "user-time-rail", role: "user", content: "With rail timestamp", timestamp: ts });
    render(<MessageBubble message={msg} />);

    fireEvent.mouseEnter(screen.getByTestId("message-time-user-rail"));

    expect(screen.getByRole("tooltip").textContent).toContain(formatExactMessageTimestamp(ts));
  });

  it("shows an unavailable rail timestamp state instead of guessing from an invalid stored time", () => {
    // Invalid timestamps still expose a truthful affordance rather than deriving a neighboring time.
    const msg = makeMessage({ id: "user-time-invalid", role: "user", content: "Bad timestamp", timestamp: Number.NaN });
    render(<MessageBubble message={msg} />);

    expect(screen.queryByTestId("message-timestamp")).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId("message-time-user-rail"));

    expect(screen.getByRole("tooltip").textContent).toContain("Time unavailable");
  });

  it("does not add a rail timestamp marker to fallback-normalized user rows", () => {
    // Fallback IDs are not stable enough for rail affordances or star actions.
    const [msg] = normalizeHistoryMessageToChatMessages(
      {
        type: "user_message",
        content: "Legacy user row without a raw stable id",
        timestamp: Date.now(),
      } satisfies BrowserIncomingMessage,
      12,
    );

    render(<MessageBubble message={msg} sessionId="star-session" />);

    expect(screen.queryByTestId("message-time-user-rail")).toBeNull();
  });

  it("pins timestamp details from a starred user rail marker on coarse-pointer tap without opening the unstar menu", () => {
    // Mobile/coarse-pointer taps use the same rail marker for timestamp inspection, avoiding accidental unstar menus.
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true,
        media: "(hover: none), (pointer: coarse)",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    const ts = new Date(2026, 6, 25, 17, 22, 13).getTime();
    const msg = makeMessage({
      id: "user-star-touch",
      role: "user",
      content: "Quick time check",
      timestamp: ts,
      historyIndex: 3,
    });
    setStarredMessage(msg);

    try {
      render(<MessageBubble message={msg} sessionId="star-session" />);

      fireEvent.click(screen.getByTestId("starred-message-user-rail"));

      expect(screen.queryByText("Unstar message")).toBeNull();
      expect(screen.getByRole("tooltip").textContent).toContain(formatExactMessageTimestamp(ts));
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      });
    }
  });

  it("shows exact timestamp details from the assistant leading rail marker on hover", () => {
    // Assistant paw/dot rail markers expose the stored timestamp without changing inline timestamp text.
    const ts = new Date(2026, 6, 25, 17, 22, 13).getTime();
    const msg = makeMessage({
      id: "assistant-time-rail",
      role: "assistant",
      content: "Timed response",
      timestamp: ts,
      historyIndex: 4,
    });
    render(<MessageBubble message={msg} />);

    fireEvent.mouseEnter(screen.getByTestId("message-time-assistant-rail"));

    expect(screen.getByRole("tooltip").textContent).toContain(formatExactMessageTimestamp(ts));
  });

  it("shows exact timestamp details from a starred assistant rail marker on focus while preserving unstar click behavior", () => {
    // Keyboard focus reveals time; ordinary activation still opens the existing star action menu on fine pointers.
    const ts = new Date(2026, 6, 25, 17, 22, 13).getTime();
    const msg = makeMessage({
      id: "assistant-starred-time-rail",
      role: "assistant",
      content: "Save this answer",
      timestamp: ts,
      historyIndex: 4,
    });
    setStarredMessage(msg);
    render(<MessageBubble message={msg} sessionId="star-session" />);

    const rail = screen.getByTestId("starred-message-assistant-rail");
    fireEvent.focus(rail);
    expect(screen.getByRole("tooltip").textContent).toContain(formatExactMessageTimestamp(ts));

    fireEvent.click(rail);
    fireEvent.click(screen.getByText("Unstar message"));

    expect(unstarMessageMock).toHaveBeenCalledWith("star-session", "assistant-starred-time-rail");
  });
});
