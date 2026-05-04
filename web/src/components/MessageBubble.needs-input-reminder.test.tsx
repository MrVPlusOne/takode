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
});
