// @vitest-environment jsdom
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ChatMessage } from "../types.js";
import { useStore } from "../store.js";

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

const checkPop = vi.hoisted(() => vi.fn());
vi.mock("./completion-celebration.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./completion-celebration.js")>()),
  playCheckPop: checkPop,
}));

import { _resetArrivalsForTest } from "./completion-celebration.js";
import { MessageBubble } from "./MessageBubble.js";

function makeMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "standalone-system-reminder",
    role: "user",
    content: "",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("MessageBubble standalone system reminder messages", () => {
  beforeEach(() => {
    revertToMessageMock.mockClear();
    markNotificationDoneMock.mockClear();
  });

  it("renders resource-lease promotions as standalone event chips without source-badge session actions", () => {
    // The collapsed chip shows the lease key and how long the session queued;
    // purpose, the exact acquisition time and the rest move to the detail.
    const msg = makeMessage({
      content: [
        "[Resource lease acquired] You now hold `agent-browser`.",
        "",
        "Slot: 1 of 1",
        "Purpose: Execute browser validation",
        "Acquired: 2026-05-10T03:30:46.717Z",
        "Waited: 3m 12s",
        "Expires: 2026-05-10T04:00:46.717Z",
        "",
        "Heartbeat with `takode lease renew agent-browser`; release with `takode lease release agent-browser` when done.",
      ].join("\n"),
      agentSource: { sessionId: "resource-lease:agent-browser", sessionLabel: "Resource Lease" },
    });

    render(<MessageBubble message={msg} showTimestamp={false} />);

    const chip = screen.getByTestId("standalone-system-reminder-chip");
    expect(chip.getAttribute("data-chip-kind")).toBe("resource-lease");
    expect(chip.textContent).toContain("Resource lease acquired");
    expect(chip.textContent).toContain("agent-browser");
    // The wait sits outside the truncating summary so a long lease key cannot hide it.
    expect(screen.getByTestId("injected-message-chip-meta").textContent).toBe("waited 3m 12s");
    expect(chip.textContent).toContain("lease");
    expect(chip.textContent).not.toContain("Execute browser validation");
    expect(chip.textContent).not.toContain("expires");
    expect(screen.queryByTestId("agent-source-badge")).toBeNull();
    expect(screen.queryByTitle("Message options")).toBeNull();
    expect(screen.queryByText(/Heartbeat with/)).toBeNull();

    fireEvent.click(chip);

    const facts = screen.getByTestId("system-reminder-detail-facts");
    const factText = (label: string) =>
      Array.from(facts.querySelectorAll("dt")).find((dt) => dt.textContent === label)?.nextElementSibling?.textContent;
    expect(factText("Acquired")).toBe(
      new Date("2026-05-10T03:30:46.717Z").toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }),
    );
    expect(factText("Waited")).toBe("3m 12s");
    expect(factText("Slot")).toBe("1 of 1");
    expect(factText("Purpose")).toBe("Execute browser validation");
    expect(factText("Expires")).toBeTruthy();
    expect(screen.getByText(/Heartbeat with/)).toBeTruthy();
    // The labeled lines appear once, in the facts list, not again in the message text.
    expect(screen.queryByText(/Purpose:/)).toBeNull();
  });

  it("falls back to the message time for lease messages from servers that did not record the wait", () => {
    const timestamp = Date.parse("2026-05-10T03:30:46.000Z");
    const msg = makeMessage({
      timestamp,
      content: [
        "[Resource lease acquired] You now hold `agent-browser`.",
        "",
        "Purpose: Execute browser validation",
        "Expires: 2026-05-10T04:00:46.717Z",
      ].join("\n"),
      agentSource: { sessionId: "resource-lease:agent-browser", sessionLabel: "Resource Lease" },
    });

    render(<MessageBubble message={msg} showTimestamp={false} />);

    const chip = screen.getByTestId("standalone-system-reminder-chip");
    expect(chip.textContent).toContain("agent-browser");
    expect(chip.textContent).not.toContain("waited");
    expect(screen.queryByTestId("injected-message-chip-meta")).toBeNull();
    expect(chip.textContent).not.toContain("Execute browser validation");

    fireEvent.click(chip);

    const facts = screen.getByTestId("system-reminder-detail-facts");
    const labels = Array.from(facts.querySelectorAll("dt")).map((dt) => dt.textContent);
    expect(labels).toEqual(["Acquired", "Purpose", "Expires"]);
    expect(facts.textContent).toContain(new Date(timestamp).getFullYear().toString());
  });

  it("renders long-sleep guard injections as standalone guard chips", () => {
    const msg = makeMessage({
      content: "Do not use `sleep` longer than 1 minute. Use `takode timer` instead of long sleeps or polling waits.",
      agentSource: { sessionId: "system:long-sleep-guard", sessionLabel: "System" },
    });

    render(<MessageBubble message={msg} showTimestamp={false} />);

    const chip = screen.getByTestId("standalone-system-reminder-chip");
    expect(chip.getAttribute("data-chip-kind")).toBe("long-sleep-guard");
    expect(chip.textContent).toContain("Long sleep guard");
    expect(chip.textContent).toContain("guard");
    expect(screen.queryByTestId("agent-source-badge")).toBeNull();
    expect(screen.queryByTitle("Message options")).toBeNull();
  });

  it("renders restart continuations as standalone recovery chips with raw text hidden until expanded", () => {
    const msg = makeMessage({
      content: "Continue.",
      agentSource: { sessionId: "system:restart-continuation:prep-1", sessionLabel: "System" },
    });

    render(<MessageBubble message={msg} showTimestamp={false} />);

    const chip = screen.getByTestId("standalone-system-reminder-chip");
    expect(chip.getAttribute("data-chip-kind")).toBe("restart-continuation");
    expect(chip.textContent).toContain("Restart continuation");
    expect(chip.textContent).toContain("system");
    expect(screen.queryByText("Continue.")).toBeNull();

    fireEvent.click(chip);

    expect(screen.getByText("Continue.")).toBeTruthy();
  });

  it("keeps event-category search highlighting on collapsed standalone system chips", () => {
    const prevSearch = useStore.getState().sessionSearch;
    const msg = makeMessage({
      id: "resource-search-msg",
      content: "[Resource lease acquired] You now hold `agent-browser`.",
      agentSource: { sessionId: "resource-lease:agent-browser", sessionLabel: "Resource Lease" },
    });
    useStore.setState({
      sessionSearch: new Map(prevSearch).set("resource-search-session", {
        query: "Resource",
        mode: "strict",
        isOpen: true,
        category: "event",
        matches: [{ messageId: msg.id }],
        currentMatchIndex: 0,
      }),
    });

    try {
      const { container } = render(
        <MessageBubble message={msg} sessionId="resource-search-session" showTimestamp={false} />,
      );

      const marks = Array.from(container.querySelectorAll("mark")).map((node) => node.textContent);
      expect(marks).toContain("Resource");
    } finally {
      useStore.setState({ sessionSearch: prevSearch });
    }
  });

  it("renders landing-queue messages as collapsed chips with the outcome as a badge", () => {
    // The leader-facing completion message from the screenshot that motivated
    // this: the chip shows only its first sentence; SHAs and the commit-links
    // command stay in the expanded detail, and the agent still gets the full text.
    const msg = makeMessage({
      content: [
        "[Landing queue] q-12 landed on jiayi and Takode completed it with final Memory's results.",
        "Target SHAs in order: e26ee0c65e679d8342964f9dd4484f4c73d99217",
        "Delivery a1b285f5b2ffc1ee6b63adbb3d5bb1c3: `quest commit-links q-12 --delivery a1b285f5b2ffc1ee6b63adbb3d5bb1c3`",
      ].join("\n"),
      agentSource: { sessionId: "landing-queue", sessionLabel: "Landing Queue" },
    });

    render(<MessageBubble message={msg} showTimestamp={false} />);

    const chip = screen.getByTestId("standalone-system-reminder-chip");
    expect(chip.getAttribute("data-chip-kind")).toBe("landing-queue");
    expect(chip.getAttribute("data-chip-tone")).toBe("success");
    expect(chip.textContent).toContain("Landing queue");
    expect(chip.textContent).toContain("q-12 landed on jiayi and Takode completed it with final Memory's results");
    expect(chip.textContent).toContain("landed");
    expect(chip.textContent).not.toContain("e26ee0c6");
    expect(chip.textContent).not.toContain("[Landing queue]");
    expect(screen.queryByTestId("agent-source-badge")).toBeNull();
    expect(screen.queryByTestId("user-message-bubble")).toBeNull();

    fireEvent.click(chip);
    expect(screen.getByText(/Target SHAs in order: e26ee0c65e679d8342964f9dd4484f4c73d99217/)).toBeTruthy();
  });

  it("pops a check on the landed badge only for a change that just landed", () => {
    _resetArrivalsForTest();
    checkPop.mockClear();
    const landing = (id: string, timestamp: number, first = "[Landing queue] q-12 landed on jiayi.") =>
      makeMessage({
        id,
        timestamp,
        content: first,
        agentSource: { sessionId: "landing-queue", sessionLabel: "Landing Queue" },
      });

    // A landing that arrives while the user watches.
    const { unmount } = render(<MessageBubble message={landing("landed-now", Date.now())} showTimestamp={false} />);
    expect(checkPop).toHaveBeenCalledTimes(1);
    // The feed remounting the row does not replay it.
    unmount();
    render(<MessageBubble message={landing("landed-now", Date.now())} showTimestamp={false} />);
    expect(checkPop).toHaveBeenCalledTimes(1);

    // History and other outcomes stay quiet.
    render(<MessageBubble message={landing("landed-yesterday", Date.now() - 86_400_000)} showTimestamp={false} />);
    render(
      <MessageBubble
        message={landing("bounced-now", Date.now(), "[Landing queue] Your change for q-7 bounced.")}
        showTimestamp={false}
      />,
    );
    expect(checkPop).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      // Worker landed message: the SHAs follow the first sentence on the same line.
      first: "[Landing queue] Your change for q-7 landed on release/1.2. Target SHAs in order: abc,def",
      summary: "Your change for q-7 landed on release/1.2",
      badge: "landed",
      tone: "success",
    },
    {
      // Run and log details in parentheses stay in the expanded text.
      first:
        "[Landing queue] Your change for q-7 bounced from main (run lr-1 on devbox, log /tmp/a.log) and did not land.",
      summary: "Your change for q-7 bounced from main and did not land",
      badge: "bounced",
      tone: "attention",
    },
    {
      first: "[Landing queue] q-7's change bounced and did not land. Reason: tests failed",
      summary: "q-7's change bounced and did not land",
      badge: "bounced",
      tone: "attention",
    },
    {
      first: "[Landing queue] q-7's change was withdrawn and did not land. Reason: none recorded",
      summary: "q-7's change was withdrawn and did not land",
      badge: "withdrawn",
      tone: "attention",
    },
    {
      // A landed change whose recording failed is a problem, not good news.
      first:
        "[Landing queue] q-7's change landed on main (target SHAs abc) but could not be completed: boom. Takode retries every few minutes.",
      summary: "q-7's change landed on main but could not be completed: boom",
      badge: "problem",
      tone: "attention",
    },
  ])("summarizes the landing-queue message $badge", ({ first, summary, badge, tone }) => {
    render(
      <MessageBubble
        message={makeMessage({
          content: `${first}\n\nMore detail.`,
          agentSource: { sessionId: "landing-queue" },
        })}
        showTimestamp={false}
      />,
    );
    const chip = screen.getByTestId("standalone-system-reminder-chip");
    expect(chip.getAttribute("data-chip-tone")).toBe(tone);
    expect(chip.textContent).toBe(`Landing queue · ${summary}${badge}`);
  });

  it("renders session recovery notices as chips naming what Takode rebuilt", () => {
    const msg = makeMessage({
      content: [
        "Takode had to rebuild part of this session before this launch. What was kept and what was lost:",
        "- Worktree: /old no longer existed, so Takode created /new on your branch b. Kept: the commits on b.",
        "- Conversation: your previous conversation is no longer saved on this session's machine.",
        "Recover your context before acting.",
      ].join("\n\n"),
      agentSource: { sessionId: "system:session-recovery", sessionLabel: "System" },
    });

    render(<MessageBubble message={msg} showTimestamp={false} />);

    const chip = screen.getByTestId("standalone-system-reminder-chip");
    expect(chip.getAttribute("data-chip-kind")).toBe("session-recovery");
    expect(chip.textContent).toContain("Session rebuilt · new worktree, conversation lost");
    expect(screen.queryByTestId("agent-source-badge")).toBeNull();
    expect(screen.queryByText(/Recover your context/)).toBeNull();

    fireEvent.click(chip);
    expect(screen.getByText(/Recover your context/)).toBeTruthy();
  });

  it("renders skill change notices as chips naming the changed skills", () => {
    // The collapsed line names the skills; the instruction to reload stays in the detail.
    const msg = makeMessage({
      content: [
        "[Skills changed] These skills changed after you loaded them: `quest`, `takode-orchestration`.",
        "Your copies of them are out of date. Load again only the ones you need.",
      ].join("\n"),
      agentSource: {
        sessionId: "system:skill-change-notice",
        sessionLabel: "Skills Changed",
      },
    });

    render(<MessageBubble message={msg} showTimestamp={false} />);

    const chip = screen.getByTestId("standalone-system-reminder-chip");
    expect(chip.getAttribute("data-chip-kind")).toBe("skills-changed");
    expect(chip.textContent).toBe("Skills changed · quest, takode-orchestrationskills");
    expect(screen.queryByText(/Load again only/)).toBeNull();

    fireEvent.click(chip);
    expect(screen.getByText(/Load again only/)).toBeTruthy();
  });
});
