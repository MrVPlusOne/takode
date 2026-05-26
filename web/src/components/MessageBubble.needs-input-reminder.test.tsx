// @vitest-environment jsdom
import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
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
import { useStore } from "../store.js";

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

function makeTruncatedNeedsInputReminderMessage(): ChatMessage {
  return {
    id: "needs-input-reminder-4",
    role: "user",
    content: [
      "[Needs-input reminder]",
      "Unresolved same-session needs-input notifications: 4. Showing newest 3.",
      "  6. Newest pending question",
      "  5. Second newest pending question",
      "  3. Third newest pending question",
      "Review or resolve these before assuming the user's latest message answered them.",
    ].join("\n"),
    timestamp: 1000,
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

  it("renders all-mentioned-resolved reminders as compact historical rows by default", async () => {
    const prevNotifications = useStore.getState().sessionNotifications;
    const nextNotifications = new Map(prevNotifications);
    nextNotifications.set("reminder-session", [
      {
        id: "n-17",
        category: "needs-input",
        summary: "Confirm rollout scope",
        timestamp: Date.now(),
        messageId: null,
        done: true,
      },
    ]);
    useStore.setState({ sessionNotifications: nextNotifications });

    try {
      render(<MessageBubble message={makeNeedsInputReminderMessage()} sessionId="reminder-session" />);

      expect(screen.getByText("Historical needs-input reminder")).toBeTruthy();
      expect(screen.getByText("resolved")).toBeTruthy();
      expect(screen.queryByTestId("agent-source-badge")).toBeNull();
      expect(screen.queryByTitle("Message options")).toBeNull();
      expect(screen.queryByText("All referenced needs-input notifications have since been resolved.")).toBeNull();
      expect(screen.queryByText("Confirm rollout scope")).toBeNull();
      expect(screen.queryByText("Unresolved same-session needs-input notifications: 1.")).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Expand Historical needs-input reminder" }));

      expect(screen.getByText("All referenced needs-input notifications have since been resolved.")).toBeTruthy();
      expect(screen.getByText("Confirm rollout scope")).toBeTruthy();
    } finally {
      useStore.setState({ sessionNotifications: prevNotifications });
    }
  });

  it("updates a reminder from active to historical when notification state changes", async () => {
    const prevNotifications = useStore.getState().sessionNotifications;
    const activeNotifications = new Map(prevNotifications);
    activeNotifications.set("reminder-session", [
      {
        id: "n-17",
        category: "needs-input",
        summary: "Confirm rollout scope",
        timestamp: Date.now(),
        messageId: null,
        done: false,
      },
    ]);
    useStore.setState({ sessionNotifications: activeNotifications });

    try {
      render(<MessageBubble message={makeNeedsInputReminderMessage()} sessionId="reminder-session" />);

      expect(screen.getByText("Needs-input reminder")).toBeTruthy();
      expect(screen.getByText("1 referenced needs-input notification is still unresolved.")).toBeTruthy();

      const resolvedNotifications = new Map(useStore.getState().sessionNotifications);
      resolvedNotifications.set("reminder-session", [
        {
          id: "n-17",
          category: "needs-input",
          summary: "Confirm rollout scope",
          timestamp: Date.now(),
          messageId: null,
          done: true,
        },
      ]);
      useStore.setState({ sessionNotifications: resolvedNotifications });

      await waitFor(() => {
        expect(screen.getByText("Historical needs-input reminder")).toBeTruthy();
      });
      expect(screen.getByText("resolved")).toBeTruthy();
      expect(screen.queryByText("All referenced needs-input notifications have since been resolved.")).toBeNull();
    } finally {
      useStore.setState({ sessionNotifications: prevNotifications });
    }
  });

  it("renders missing notification references compactly without claiming resolution", async () => {
    const prevNotifications = useStore.getState().sessionNotifications;
    const nextNotifications = new Map(prevNotifications);
    nextNotifications.set("reminder-session", []);
    useStore.setState({ sessionNotifications: nextNotifications });

    try {
      render(<MessageBubble message={makeNeedsInputReminderMessage()} sessionId="reminder-session" />);

      expect(screen.getByText("Historical needs-input reminder")).toBeTruthy();
      expect(screen.getByText("state unavailable")).toBeTruthy();
      expect(screen.queryByText("Notification state is no longer available for this historical reminder.")).toBeNull();
      expect(screen.queryByText("All referenced needs-input notifications have since been resolved.")).toBeNull();
      expect(screen.queryByText("Unresolved same-session needs-input notifications: 1.")).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Expand Historical needs-input reminder" }));

      expect(screen.getByText("Notification state is no longer available for this historical reminder.")).toBeTruthy();
      expect(screen.getByText("Confirm rollout scope")).toBeTruthy();
    } finally {
      useStore.setState({ sessionNotifications: prevNotifications });
    }
  });

  it("keeps truncated reminders active when an unlisted older notification is still unresolved", () => {
    const prevNotifications = useStore.getState().sessionNotifications;
    const nextNotifications = new Map(prevNotifications);
    nextNotifications.set("reminder-session", [
      {
        id: "n-6",
        category: "needs-input",
        summary: "Newest pending question",
        timestamp: 600,
        messageId: null,
        done: true,
      },
      {
        id: "n-5",
        category: "needs-input",
        summary: "Second newest pending question",
        timestamp: 500,
        messageId: null,
        done: true,
      },
      {
        id: "n-3",
        category: "needs-input",
        summary: "Third newest pending question",
        timestamp: 300,
        messageId: null,
        done: true,
      },
      {
        id: "n-1",
        category: "needs-input",
        summary: "Hidden older question",
        timestamp: 100,
        messageId: null,
        done: false,
      },
    ]);
    useStore.setState({ sessionNotifications: nextNotifications });

    try {
      render(<MessageBubble message={makeTruncatedNeedsInputReminderMessage()} sessionId="reminder-session" />);

      expect(screen.getByText("Needs-input reminder")).toBeTruthy();
      expect(
        screen.getByText("1 unlisted needs-input notification from this reminder may still be unresolved."),
      ).toBeTruthy();
      expect(screen.getByText("Newest pending question")).toBeTruthy();
      expect(screen.queryByText("Historical needs-input reminder")).toBeNull();
      expect(screen.queryByText("All referenced needs-input notifications have since been resolved.")).toBeNull();
    } finally {
      useStore.setState({ sessionNotifications: prevNotifications });
    }
  });

  it("renders truncated all-listed-resolved reminders as partial state instead of fully resolved", () => {
    const prevNotifications = useStore.getState().sessionNotifications;
    const nextNotifications = new Map(prevNotifications);
    nextNotifications.set("reminder-session", [
      {
        id: "n-6",
        category: "needs-input",
        summary: "Newest pending question",
        timestamp: 600,
        messageId: null,
        done: true,
      },
      {
        id: "n-5",
        category: "needs-input",
        summary: "Second newest pending question",
        timestamp: 500,
        messageId: null,
        done: true,
      },
      {
        id: "n-3",
        category: "needs-input",
        summary: "Third newest pending question",
        timestamp: 300,
        messageId: null,
        done: true,
      },
    ]);
    useStore.setState({ sessionNotifications: nextNotifications });

    try {
      render(<MessageBubble message={makeTruncatedNeedsInputReminderMessage()} sessionId="reminder-session" />);

      expect(screen.getByText("Needs-input reminder")).toBeTruthy();
      expect(screen.getByText("partial state")).toBeTruthy();
      expect(
        screen.getByText(
          "This reminder originally had 4 unresolved notifications but only listed 3; 1 unlisted notification state is unavailable.",
        ),
      ).toBeTruthy();
      expect(screen.getByText("Newest pending question")).toBeTruthy();
      expect(screen.queryByText("Historical needs-input reminder")).toBeNull();
      expect(screen.queryByText("All referenced needs-input notifications have since been resolved.")).toBeNull();
    } finally {
      useStore.setState({ sessionNotifications: prevNotifications });
    }
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

    expect(screen.getByText("2.")).toBeTruthy();
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
