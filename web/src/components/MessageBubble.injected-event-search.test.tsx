// @vitest-environment jsdom
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import {
  COMPACTION_RECOVERY_SOURCE_ID,
  COMPACTION_RECOVERY_SOURCE_LABEL,
} from "../../shared/injected-event-message.js";
import type { ChatMessage } from "../types.js";

const revertToMessageMock = vi.hoisted(() => vi.fn(async () => ({})));
const markNotificationDoneMock = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock("../api.js", () => ({
  api: {
    revertToMessage: revertToMessageMock,
    markNotificationDone: markNotificationDoneMock,
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
    if (components?.p) {
      return <div data-testid="markdown">{components.p({ children })}</div>;
    }
    return <div data-testid="markdown">{children}</div>;
  },
}));

vi.mock("remark-gfm", () => ({
  default: {},
}));

import { MessageBubble } from "./MessageBubble.js";
import { useStore } from "../store.js";

function makeMessage(overrides: Partial<ChatMessage> & { role: ChatMessage["role"] }): ChatMessage {
  return {
    id: "message-id",
    content: "",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("MessageBubble injected event search highlighting", () => {
  it("highlights injected event chips when search is filtered to events", () => {
    const prevSessionSearch = useStore.getState().sessionSearch;
    const msg = makeMessage({
      id: "compaction-event-search-msg",
      role: "user",
      content: [
        "Context was compacted. Before continuing, recover enough context from your own session history to safely resume work:",
        "",
        "1. Inspect your own session history with Takode tools.",
      ].join("\n"),
      agentSource: {
        sessionId: COMPACTION_RECOVERY_SOURCE_ID,
        sessionLabel: COMPACTION_RECOVERY_SOURCE_LABEL,
      },
    });

    useStore.setState({
      sessionSearch: new Map(prevSessionSearch).set("injected-event-search-session", {
        query: "recover",
        isOpen: true,
        mode: "strict",
        category: "event",
        matches: [{ messageId: msg.id }],
        currentMatchIndex: 0,
      }),
    });

    try {
      const { container } = render(
        <MessageBubble message={msg} sessionId="injected-event-search-session" showTimestamp={false} />,
      );

      const chip = screen.getByRole("button", { name: `Expand ${COMPACTION_RECOVERY_SOURCE_LABEL}` });
      expect(chip.getAttribute("aria-expanded")).toBe("false");

      const marks = Array.from(container.querySelectorAll("mark"));
      expect(marks.map((node) => node.textContent)).toContain("Recover");
      expect(marks[0]?.className).toContain("bg-amber-400/70");
    } finally {
      useStore.setState({ sessionSearch: prevSessionSearch });
    }
  });
});
