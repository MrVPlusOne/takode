// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestSlackRefresh } from "../api/session-drafts.js";
import { applySessionNotifications } from "../notification-status.js";
import { useStore } from "../store.js";
import type { SessionNotification } from "../types.js";
import { NotificationMarker } from "./NotificationMarker.js";

vi.mock("../api.js", () => ({
  api: { getNotificationReplies: vi.fn().mockResolvedValue({ replies: [] }) },
}));
vi.mock("../api/session-drafts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/session-drafts.js")>()),
  requestSlackRefresh: vi.fn(),
}));

const SESSION = "slack-refresh";
const question: SessionNotification = {
  id: "n-1",
  category: "needs-input",
  summary: "Ship it?",
  questions: [{ prompt: "Ship it?", suggestedAnswers: ["yes", "no"] }],
  messageId: null,
  timestamp: 10,
  done: false,
};

function show(notification: SessionNotification) {
  act(() => applySessionNotifications(SESSION, [notification], {}));
  return render(<NotificationMarker sessionId={SESSION} category="needs-input" notificationId="n-1" />);
}

beforeEach(() => {
  useStore.getState().reset();
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("Needs-input card and Slack updates", () => {
  it("asks for fresh Slack updates when an open question is shown and when its answer box is focused", () => {
    // The answer carries the session's Slack updates, so they should be fresh
    // by the time the user sends it, even if they answer without typing much.
    show(question);
    expect(requestSlackRefresh).toHaveBeenCalledWith(SESSION);
    fireEvent.focus(screen.getByLabelText("Answer for Ship it?"));
    expect(requestSlackRefresh).toHaveBeenCalledTimes(2);
  });

  it("leaves Slack alone for an answered question", () => {
    show({ ...question, done: true });
    expect(requestSlackRefresh).not.toHaveBeenCalled();
  });
});
