// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api.js";
import { applySessionNotifications } from "../notification-status.js";
import { useStore } from "../store.js";
import type { SessionNotification } from "../types.js";
import { NotificationMarker } from "./NotificationMarker.js";
import { AttentionLedgerRow } from "./AttentionLedgerRow.js";
import { buildAttentionRecords } from "../utils/attention-records.js";

vi.mock("../api.js", () => ({
  api: {
    getNotificationReplies: vi.fn(),
    markNotificationDone: vi.fn().mockResolvedValue({ ok: true }),
    sendNeedsInputResponse: vi.fn(),
  },
}));

const SESSION = "notification-history";
const notification: SessionNotification = {
  id: "n-1",
  category: "needs-input",
  summary: "Choose rollout timing",
  questions: [{ prompt: "When should the rollout begin?", suggestedAnswers: ["After review", "Tomorrow"] }],
  messageId: "decision",
  timestamp: 10,
  done: false,
};
function update(value: SessionNotification) {
  act(() => applySessionNotifications(SESSION, [value], {}));
}
function card(id = notification.id) {
  return (
    <NotificationMarker sessionId={SESSION} category="needs-input" notificationId={id} summary={notification.summary} />
  );
}
beforeEach(() => {
  useStore.getState().reset();
  vi.clearAllMocks();
  vi.mocked(api.getNotificationReplies).mockResolvedValue({ replies: [] });
});
afterEach(cleanup);

describe("Completed needs-input cards", () => {
  it("keeps a fallback decision card after resolution in its owner thread", () => {
    // Missing anchors use a ledger row; its resolved state must keep the same
    // inspectable card instead of disappearing or becoming a generic chip.
    const pending = { ...notification, messageId: null, threadKey: "q-983", questId: "q-983" };
    const resolved = { ...pending, done: true };
    const record = (value: SessionNotification) =>
      buildAttentionRecords({ leaderSessionId: SESSION, notifications: [value] })[0];
    update(pending);
    const view = render(<AttentionLedgerRow sessionId={SESSION} currentThreadKey="q-983" record={record(pending)} />);
    const originalCard = view.container.querySelector('[data-notification-category="needs-input"]');
    update(resolved);
    view.rerender(<AttentionLedgerRow sessionId={SESSION} currentThreadKey="q-983" record={record(resolved)} />);
    expect(view.container.querySelector('[data-notification-category="needs-input"]')).toBe(originalCard);
    expect(screen.getByRole("button", { name: "Choose rollout timing Handled" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByTestId("attention-ledger-row")).not.toBeInTheDocument();
  });

  it("keeps the same card on authoritative answer, collapses it, and opens full questions and exact responses", async () => {
    // The notification update changes presentation, while the response lookup is
    // lazy and read-only. Even a long reply keeps all text and whitespace.
    update(notification);
    const view = render(card());
    const originalCard = view.container.querySelector('[data-notification-id="n-1"]');
    expect(screen.getByLabelText("Answer for When should the rollout begin?")).toBeInTheDocument();
    expect(api.getNotificationReplies).not.toHaveBeenCalled();
    update({
      ...notification,
      done: true,
      resolutionNotice: { source: "response", status: "delivered", resolvedAt: 20 },
    });
    expect(view.container.querySelector('[data-notification-id="n-1"]')).toBe(originalCard);
    expect(screen.queryByTestId("notification-answer-actions")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Choose rollout timing Answered" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(api.getNotificationReplies).not.toHaveBeenCalled();
    const content = "  After review.\n\n" + "Keep this detail. ".repeat(1000);
    vi.mocked(api.getNotificationReplies).mockResolvedValue({ replies: [{ content }] });
    fireEvent.click(toggle);
    expect(await screen.findByText("Your response")).toBeInTheDocument();
    expect(screen.getByTestId("notification-response-history").textContent).toContain(content);
    expect(screen.getByText(notification.questions![0].prompt)).toBeInTheDocument();
    expect(api.getNotificationReplies).toHaveBeenCalledExactlyOnceWith(SESSION, "n-1");
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("notification-response-history")).not.toBeInTheDocument();
    expect(api.markNotificationDone).not.toHaveBeenCalled();
    expect(api.sendNeedsInputResponse).not.toHaveBeenCalled();
  });

  it("retains every original question and distinguishes handled history with no saved response", async () => {
    // Resolving a notification is not proof of a human answer. Old data without
    // resolution metadata remains inspectable and does not invent a response.
    update({ ...notification, done: true, questions: [{ prompt: "Which plan?" }, { prompt: "When?" }] });
    render(card());
    fireEvent.click(screen.getByRole("button", { name: "Choose rollout timing Handled" }));
    expect(screen.getByText("Which plan?")).toBeInTheDocument();
    expect(screen.getByText("When?")).toBeInTheDocument();
    expect(await screen.findByText("No saved response is available.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reply" })).not.toBeInTheDocument();
  });

  it("retries failed detail reads and ignores results after the card closes", async () => {
    // A failed fetch must not be presented as evidence that no response exists.
    update({ ...notification, done: true });
    vi.mocked(api.getNotificationReplies).mockRejectedValueOnce(new Error("offline"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(card());
    const toggle = screen.getByRole("button", { name: "Choose rollout timing Handled" });
    fireEvent.click(toggle);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No saved response is available.")).toBeInTheDocument();
    expect(api.getNotificationReplies).toHaveBeenCalledTimes(2);
    fireEvent.click(toggle);
    let finish!: (value: { replies: Array<{ content: string }> }) => void;
    vi.mocked(api.getNotificationReplies).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.click(toggle);
    expect(screen.getByText("Loading responses...")).toBeInTheDocument();
    fireEvent.click(toggle);
    await act(async () => finish({ replies: [{ content: "Late response" }] }));
    expect(screen.queryByText("Late response")).not.toBeInTheDocument();
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it("reopens a handled card for answering only after authoritative state changes", () => {
    // Expanding history and reopening the notification are distinct controls.
    update({ ...notification, done: true });
    render(card());
    fireEvent.click(screen.getByRole("button", { name: "Mark unhandled" }));
    expect(api.markNotificationDone).toHaveBeenCalledWith(SESSION, "n-1", false);
    expect(screen.queryByTestId("notification-answer-actions")).not.toBeInTheDocument();
    update(notification);
    expect(screen.getByTestId("notification-answer-actions")).toBeInTheDocument();
  });
});
