// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api.js";
import { applySessionNotifications } from "../notification-status.js";
import { useStore } from "../store.js";
import type { ChatMessage, SessionNotification } from "../types.js";
import { getNotificationSourceContext } from "../utils/notification-source-context.js";
import { NotificationMarker } from "./NotificationMarker.js";

vi.mock("../api.js", () => ({
  api: {
    getNotificationReplies: vi.fn(),
    markNotificationDone: vi.fn().mockResolvedValue({ ok: true }),
    sendNeedsInputResponse: vi.fn(),
  },
}));

const SESSION = "notification-body";
const notification: SessionNotification = {
  id: "n-1",
  category: "needs-input",
  summary: "Approve the menu change",
  body: "Keep **Manual** and *Full access*.\n\n- Rename Default: recommended",
  questions: [{ prompt: "Approve?", suggestedAnswers: ["approve", "change something"] }],
  messageId: "tool-only",
  timestamp: 10,
  done: false,
};

function update(value: SessionNotification) {
  act(() => applySessionNotifications(SESSION, [value], {}));
}

beforeEach(() => {
  useStore.getState().reset();
  vi.clearAllMocks();
  vi.mocked(api.getNotificationReplies).mockResolvedValue({ replies: [] });
});
afterEach(cleanup);

describe("Needs-input card body", () => {
  it("renders the decision context as Markdown in the pending card and keeps it in the answered history", () => {
    // The body is the only place the decision context lives, so it must be
    // visible while pending and still inspectable after the prompt is handled.
    update(notification);
    const view = render(
      <NotificationMarker
        sessionId={SESSION}
        category="needs-input"
        notificationId="n-1"
        summary={notification.summary}
      />,
    );
    const body = screen.getByTestId("notification-body");
    expect(within(body).getByText("Manual").tagName).toBe("STRONG");
    expect(body).toHaveTextContent("Rename Default: recommended");
    expect(screen.getByLabelText("Answer for Approve?")).toBeInTheDocument();

    update({ ...notification, done: true });
    view.rerender(
      <NotificationMarker
        sessionId={SESSION}
        category="needs-input"
        notificationId="n-1"
        summary={notification.summary}
      />,
    );
    expect(screen.queryByTestId("notification-body")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve the menu change Handled" }));
    expect(screen.getByTestId("notification-body")).toHaveTextContent("Keep Manual and Full access.");
  });

  it("uses the body as the notification source context instead of the anchored message text", () => {
    // Menus and voice answers read source context; with a body, the anchored
    // tool-call message is not the decision context.
    const anchored: ChatMessage = { id: "tool-only", role: "assistant", content: "Ran a command", timestamp: 1 };
    expect(getNotificationSourceContext(notification, [anchored])).toBe(notification.body);
    expect(getNotificationSourceContext({ ...notification, body: undefined }, [anchored])).toBe("Ran a command");
  });
});
