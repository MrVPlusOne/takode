// @vitest-environment jsdom
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  COMPACTION_RECOVERY_SOURCE_ID,
  COMPACTION_RECOVERY_SOURCE_LABEL,
  CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID,
  CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL,
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
import { buildInjectedEventMessageViewModel } from "../utils/injected-event-message.js";

function makeMessage(overrides: Partial<ChatMessage> & { role: ChatMessage["role"] }): ChatMessage {
  return {
    id: "message-id",
    content: "",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("MessageBubble injected event search highlighting", () => {
  it("builds injected event view models with raw character sizes and memory catalog source guidance", () => {
    const skillName = "quest";
    const skillContent = [
      `Required leader skill preloaded: ${skillName}`,
      "",
      "Use this content as already-loaded leader context.",
    ].join("\n");
    const skillEvent = buildInjectedEventMessageViewModel({
      content: skillContent,
      agentSource: {
        sessionId: leaderSkillPreloadSourceId(skillName),
        sessionLabel: leaderSkillPreloadSourceLabel(skillName),
      },
    });

    expect(skillEvent?.messageSizeChars).toBe(skillContent.length);

    const memoryContent = [
      MEMORY_CATALOG_TITLE,
      "",
      "This automatically injected catalog is the result of `memory catalog show` at injection time.",
      "Memory repo: /tmp/test-memory",
    ].join("\n");
    const memoryEvent = buildInjectedEventMessageViewModel({
      content: memoryContent,
      agentSource: {
        sessionId: MEMORY_CATALOG_SOURCE_ID,
        sessionLabel: MEMORY_CATALOG_SOURCE_LABEL,
      },
    });

    expect(memoryEvent?.messageSizeChars).toBe(memoryContent.length);
    expect(memoryEvent?.description).toContain("`memory catalog show` snapshot from injection time");
    expect(memoryEvent?.description).toContain("`memory catalog diff`");
  });

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

  it("renders routed Codex recovery guidance as an unobtrusive collapsed event", () => {
    const msg = makeMessage({
      role: "user",
      content: [
        "Codex recovery diagnostic: automatic replay stopped after the partial leader response above.",
        "Review the partial response and send a new continuation only if the intended outcome is still missing.",
      ].join("\n"),
      agentSource: {
        sessionId: CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID,
        sessionLabel: CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL,
      },
    });

    render(<MessageBubble message={msg} showTimestamp={false} />);

    const chip = screen.getByRole("button", { name: `Expand ${CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL}` });
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(chip.textContent).toContain(CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL);
    expect(chip.className).not.toContain("red-");
    expect(screen.queryByText(/send a new continuation/)).toBeNull();

    fireEvent.click(chip);

    expect(screen.getByText(/send a new continuation/)).toBeTruthy();
    expect(screen.getByText(/protect exact-once delivery/)).toBeTruthy();
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
    expect(chip.textContent).not.toContain("characters");
    expect(screen.queryByText("Questmaster docs body")).toBeNull();
    expect(screen.queryByText("Provenance:")).toBeNull();

    fireEvent.click(chip);

    expect(screen.getByText(`Message size: ${msg.content.length.toLocaleString()} characters`)).toBeTruthy();
    expect(screen.getByText(/Questmaster docs body/)).toBeTruthy();
  });

  it("renders truncated memory catalog injections as warning event chips", () => {
    const msg = makeMessage({
      role: "user",
      content: [
        MEMORY_CATALOG_TITLE,
        "",
        MEMORY_CATALOG_TRUNCATED_PREFIX + " the catalog hit Takode's 100,000 character injected-context limit.",
        "The preloaded content is truncated. If you need the full current catalog, run `memory catalog show`; for freshness since this injection, use `memory catalog diff`. Inspect relevant Markdown files directly before relying on memory facts.",
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
    expect(screen.getByText(/memory catalog snapshot needs attention/)).toBeTruthy();
    expect(screen.getByText(`Message size: ${msg.content.length.toLocaleString()} characters`)).toBeTruthy();
    expect(screen.getByText(/The preloaded content is truncated/)).toBeTruthy();
  });
});
