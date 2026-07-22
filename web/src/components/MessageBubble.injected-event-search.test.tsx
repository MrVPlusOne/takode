// @vitest-environment jsdom
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  COMPACTION_RECOVERY_SOURCE_ID,
  COMPACTION_RECOVERY_SOURCE_LABEL,
  MEMORY_CATALOG_SOURCE_ID,
  MEMORY_CATALOG_SOURCE_LABEL,
  MEMORY_CATALOG_TITLE,
  MEMORY_CATALOG_TRUNCATED_PREFIX,
  leaderSkillPreloadSourceId,
  leaderSkillPreloadSourceLabel,
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

  it("renders leader skill preload injections as collapsed event chips by default", () => {
    const skillName = "quest";
    const msg = makeMessage({
      id: "leader-skill-preload-msg",
      role: "user",
      content: [
        `Required leader skill preloaded: ${skillName}`,
        "",
        "Use this content as already-loaded leader context. Do not reread this mandatory skill via tool calls unless checking freshness or debugging.",
        "",
        "Questmaster docs body",
      ].join("\n"),
      agentSource: {
        sessionId: leaderSkillPreloadSourceId(skillName),
        sessionLabel: leaderSkillPreloadSourceLabel(skillName),
      },
    });

    render(<MessageBubble message={msg} sessionId="leader-skill-preload-session" showTimestamp={false} />);

    const chip = screen.getByRole("button", { name: `Expand Required leader skill preloaded: ${skillName}` });
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(chip.textContent).toContain("Required leader skill preloaded: quest");
    expect(chip.textContent).toContain("event");
    expect(screen.queryByText("Questmaster docs body")).toBeNull();
    expect(screen.queryByText("Provenance:")).toBeNull();
  });

  it("renders truncated memory catalog injections as warning event chips", () => {
    const msg = makeMessage({
      role: "user",
      content: [
        MEMORY_CATALOG_TITLE,
        "",
        MEMORY_CATALOG_TRUNCATED_PREFIX + " the catalog hit Takode's 100,000 character injected-context limit.",
        "Run `memory catalog show` manually and inspect relevant Markdown files directly for the full catalog before relying on memory facts.",
        "",
        "Memory repo: /tmp/test-memory",
      ].join("\n"),
      agentSource: {
        sessionId: MEMORY_CATALOG_SOURCE_ID,
        sessionLabel: MEMORY_CATALOG_SOURCE_LABEL,
      },
    });

    render(<MessageBubble message={msg} showTimestamp={false} />);

    const chip = screen.getByRole("button", { name: `Expand ${MEMORY_CATALOG_TITLE}` });
    expect(chip.textContent).toContain("warning");
    expect(chip.className).toContain("red");
    expect(screen.queryByText(/Memory repo:/)).toBeNull();

    fireEvent.click(chip);

    expect(screen.getByRole("button", { name: `Collapse ${MEMORY_CATALOG_TITLE}` })).toBeTruthy();
    expect(screen.getByText(/needs attention/)).toBeTruthy();
    expect(screen.getByText(/Run `memory catalog show` manually/)).toBeTruthy();
  });
});
