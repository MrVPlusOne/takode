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
    const msg = makeMessage({
      content: [
        "[Resource lease acquired] You now hold `agent-browser`.",
        "",
        "Purpose: Execute browser validation",
        "Expires: 2026-05-10T04:00:46.717Z",
        "",
        "Heartbeat with `takode lease renew agent-browser`; release with `takode lease release agent-browser` when done.",
      ].join("\n"),
      agentSource: { sessionId: "resource-lease:agent-browser", sessionLabel: "Resource Lease" },
    });

    render(<MessageBubble message={msg} showTimestamp={false} />);

    const chip = screen.getByTestId("standalone-system-reminder-chip");
    expect(chip.getAttribute("data-reminder-kind")).toBe("resource-lease");
    expect(chip.textContent).toContain("Resource lease acquired");
    expect(chip.textContent).toContain("agent-browser");
    expect(chip.textContent).toContain("lease");
    expect(screen.queryByTestId("agent-source-badge")).toBeNull();
    expect(screen.queryByTitle("Message options")).toBeNull();
    expect(screen.queryByText(/Heartbeat with/)).toBeNull();

    fireEvent.click(chip);

    expect(screen.getByText(/Heartbeat with/)).toBeTruthy();
  });

  it("renders long-sleep guard injections as standalone guard chips", () => {
    const msg = makeMessage({
      content: "Do not use `sleep` longer than 1 minute. Use `takode timer` instead of long sleeps or polling waits.",
      agentSource: { sessionId: "system:long-sleep-guard", sessionLabel: "System" },
    });

    render(<MessageBubble message={msg} showTimestamp={false} />);

    const chip = screen.getByTestId("standalone-system-reminder-chip");
    expect(chip.getAttribute("data-reminder-kind")).toBe("long-sleep-guard");
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
    expect(chip.getAttribute("data-reminder-kind")).toBe("restart-continuation");
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
});
