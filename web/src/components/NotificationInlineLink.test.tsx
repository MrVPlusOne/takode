// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useStore } from "../store.js";
import type { SessionNotification } from "../types.js";

const mockGetSessionNotifications = vi.fn();

vi.mock("../api.js", () => ({
  api: {
    getSessionNotifications: (...args: unknown[]) => mockGetSessionNotifications(...args),
  },
}));

import { MarkdownContent } from "./MarkdownContent.js";
import { notificationLinkStatusLabel } from "./NotificationInlineLink.js";

function notification(overrides: Partial<SessionNotification> = {}): SessionNotification {
  return {
    id: "n-3",
    category: "needs-input",
    summary: "Approve the deploy?",
    timestamp: 1,
    messageId: "msg-anchor",
    threadKey: "q-9",
    questId: "q-9",
    done: false,
    ...overrides,
  };
}

function seedSession(notifications?: SessionNotification[]) {
  useStore.setState((state) => ({
    ...state,
    sdkSessions: [
      {
        sessionId: "session-12",
        state: "connected",
        cwd: "/repo",
        createdAt: 1,
        sessionNum: 12,
        name: "Deploy Worker",
      },
    ],
    sessionNotifications: notifications ? new Map([["session-12", notifications]]) : new Map(),
  }));
}

describe("needs-input notification links", () => {
  beforeEach(() => {
    useStore.getState().reset();
    mockGetSessionNotifications.mockReset();
    window.location.hash = "";
  });

  it("previews a loaded notification and jumps to its card in the owner thread", async () => {
    // The label stays human-readable; the session-scoped ID only lives in the href.
    seedSession([notification()]);
    render(<MarkdownContent text="See [the deploy question](session:12:notification:3)." />);

    const link = screen.getByRole("link", { name: "the deploy question" });
    expect(link.textContent).not.toContain("3");
    fireEvent.mouseEnter(link);
    const card = await screen.findByTestId("notification-link-hover-card");
    expect(card.textContent).toContain("Needs input · #12 Deploy Worker");
    expect(card.textContent).toContain("Approve the deploy?");
    expect(card.textContent).toContain("Open");
    expect(mockGetSessionNotifications).not.toHaveBeenCalled();

    fireEvent.click(link);
    await waitFor(() => expect(window.location.hash).toContain("/msg/msg-anchor"));
    expect(window.location.hash).toContain("q-9");
  });

  it("fetches notifications for sessions that are not loaded in this browser", async () => {
    // A leader can link a worker's prompt; that worker's notifications are not in the store.
    seedSession();
    mockGetSessionNotifications.mockResolvedValue([
      notification({
        muted: true,
        snoozedUntil: Date.now() + 3_600_000,
        questions: [{ prompt: "Which region?" }],
      }),
    ]);
    render(<MarkdownContent text="[region question](session:12:notification:n-3)" />);

    fireEvent.mouseEnter(screen.getByRole("link", { name: "region question" }));
    expect(await screen.findByText("Which region?")).toBeTruthy();
    expect(screen.getByTestId("notification-link-hover-card").textContent).toContain("Snoozed until");
    expect(mockGetSessionNotifications).toHaveBeenCalledWith("session-12");
  });

  it("falls back to opening the session when the notification no longer exists", async () => {
    seedSession();
    mockGetSessionNotifications.mockResolvedValue([]);
    render(<MarkdownContent text="[old question](session:12:notification:5)" />);

    const link = screen.getByRole("link", { name: "old question" });
    fireEvent.mouseEnter(link);
    expect(await screen.findByText("Notification unavailable.")).toBeTruthy();
    fireEvent.click(link);
    await waitFor(() => expect(window.location.hash).toBe("#/session/session-12"));
  });

  it("renders a muted, inert link when the session is unknown", () => {
    seedSession();
    render(<MarkdownContent text="[lost question](session:99:notification:1)" />);

    const link = screen.getByRole("link", { name: "lost question" });
    expect(link.getAttribute("title")).toBe("Session #99 not found");
    expect(link.className).toContain("text-cc-muted");
  });

  it("labels answered and muted prompts", () => {
    expect(notificationLinkStatusLabel(notification({ done: true }))).toBe("Answered");
    expect(notificationLinkStatusLabel(notification({ muted: true }))).toBe("Muted");
    expect(notificationLinkStatusLabel(notification({ category: "review", done: true }))).toBe("Done");
  });
});
