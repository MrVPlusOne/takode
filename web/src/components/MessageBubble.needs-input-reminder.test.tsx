// @vitest-environment jsdom
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function makeNeedsInputReminderMessage(): ChatMessage {
  return {
    id: "needs-input-reminder-1",
    role: "user",
    content: [
      "[Needs-input reminder]",
      "Unresolved same-session needs-input notifications: 1.",
      "  17. Confirm rollout scope",
      "Review or resolve these before assuming the user's latest message answered them.",
    ].join("\n"),
    timestamp: Date.now(),
    agentSource: {
      sessionId: "system:needs-input-reminder",
      sessionLabel: "Needs Input Reminder",
    },
  };
}

function makeNeedsInputResolutionNoticeMessage(): ChatMessage {
  return {
    id: "needs-input-resolution-notice-1",
    role: "user",
    content: [
      "[Needs-input resolution notice]",
      "Resolved same-session same-thread needs-input (q-1431): 1.",
      "  487. confirm collapsible commits section quest (answered in notification UI).",
      "Do not run `takode notify resolve` for these same-session prompts unless a new prompt is recreated later.",
    ].join("\n"),
    timestamp: Date.now(),
    agentSource: {
      sessionId: "system:needs-input-resolution",
      sessionLabel: "Needs Input Resolution",
    },
    metadata: {
      threadKey: "q-1431",
      questId: "q-1431",
      threadRefs: [{ threadKey: "q-1431", questId: "q-1431", source: "explicit" }],
    },
  };
}

function makeLegacyNeedsInputResolutionNoticeMessage(): ChatMessage {
  return {
    id: "needs-input-resolution-notice-legacy",
    role: "user",
    content: [
      "[Needs-input resolution notice]",
      "Externally resolved same-session same-thread needs-input notifications (main): 1.",
      "  2. Already handled -- dismissed or resolved outside the agent.",
      "Do not call `takode notify resolve` for these notifications unless you later recreate a new prompt.",
    ].join("\n"),
    timestamp: Date.now(),
    agentSource: {
      sessionId: "system:needs-input-resolution",
      sessionLabel: "Needs Input Resolution",
    },
  };
}

function makeUnparseableNeedsInputResolutionNoticeMessage(): ChatMessage {
  return {
    id: "needs-input-resolution-notice-unparseable",
    role: "user",
    content: "Unparseable externally resolved notice\nRaw resolution content stays visible on expand.",
    timestamp: Date.now(),
    agentSource: {
      sessionId: "system:needs-input-resolution",
      sessionLabel: "Needs Input Resolution",
    },
  };
}

describe("MessageBubble needs-input reminder messages", () => {
  beforeEach(() => {
    revertToMessageMock.mockClear();
    markNotificationDoneMock.mockClear();
  });

  it("renders a stored needs-input reminder as nothing", () => {
    // Takode no longer copies the reminder into the feed (the user sees open questions as "Needs you"
    // items); an older stored copy that still reaches a bubble shows nothing rather than a user bubble.
    const { container } = render(<MessageBubble message={makeNeedsInputReminderMessage()} sessionId="s1" />);
    expect(container.textContent).toBe("");
  });

  it("renders needs-input resolution notices as collapsed special-message chips", async () => {
    render(<MessageBubble message={makeNeedsInputResolutionNoticeMessage()} sessionId="resolution-session" />);

    const chip = screen.getByTestId("needs-input-resolution-notice-chip");
    expect(chip).toBeTruthy();
    expect(screen.getByText("Needs-input resolution notice")).toBeTruthy();
    expect(chip.textContent).toContain("1 resolved externally in q-1431");
    expect(screen.getByText("resolved")).toBeTruthy();
    expect(screen.queryByTestId("agent-source-badge")).toBeNull();
    expect(screen.queryByTitle("Message options")).toBeNull();
    expect(screen.queryByText("confirm collapsible commits section quest")).toBeNull();
    expect(screen.queryByText(/takode notify resolve/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Expand Needs-input resolution notice" }));

    expect(screen.getByText("confirm collapsible commits section quest")).toBeTruthy();
    expect(screen.getByText(/Do not run `takode notify resolve`/)).toBeTruthy();
  });

  it("renders legacy verbose needs-input resolution notices as collapsed special-message chips", async () => {
    render(<MessageBubble message={makeLegacyNeedsInputResolutionNoticeMessage()} sessionId="resolution-session" />);

    const chip = screen.getByTestId("needs-input-resolution-notice-chip");
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain("1 resolved externally in main");
    expect(screen.queryByTestId("user-message-bubble")).toBeNull();
    expect(screen.queryByTestId("agent-source-badge")).toBeNull();
    expect(screen.queryByTitle("Message options")).toBeNull();
    expect(screen.queryByText("Already handled")).toBeNull();
    expect(screen.queryByText("(dismissed or resolved outside the agent)")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Expand Needs-input resolution notice" }));

    // Users never see notification IDs, so the legacy entry number is not shown.
    expect(screen.queryByText("2.")).toBeNull();
    expect(screen.getByText("Already handled")).toBeTruthy();
    expect(screen.getByText("(dismissed or resolved outside the agent)")).toBeTruthy();
  });

  it("renders unparseable source-tagged needs-input resolution notices as raw expandable chips", async () => {
    render(
      <MessageBubble message={makeUnparseableNeedsInputResolutionNoticeMessage()} sessionId="resolution-session" />,
    );

    const chip = screen.getByTestId("needs-input-resolution-notice-chip");
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain("Resolved externally");
    expect(screen.queryByTestId("user-message-bubble")).toBeNull();
    expect(screen.queryByTestId("agent-source-badge")).toBeNull();
    expect(screen.queryByTitle("Message options")).toBeNull();
    expect(screen.queryByText(/Raw resolution content stays visible/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Expand Needs-input resolution notice" }));

    expect(screen.getByText(/Unparseable externally resolved notice/)).toBeTruthy();
    expect(screen.getByText(/Raw resolution content stays visible on expand/)).toBeTruthy();
  });
});
