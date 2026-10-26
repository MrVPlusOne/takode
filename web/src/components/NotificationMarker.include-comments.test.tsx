// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationAnnotation } from "../../shared/conversation-annotations.js";
import { api } from "../api.js";
import { applySessionNotifications } from "../notification-status.js";
import { useStore } from "../store.js";
import type { SessionNotification } from "../types.js";
import { NotificationMarker } from "./NotificationMarker.js";

vi.mock("../api.js", () => ({
  api: {
    getNotificationReplies: vi.fn(),
    markNotificationDone: vi.fn(),
    sendNeedsInputResponse: vi.fn(),
  },
}));

const SESSION = "include-comments";
const notification: SessionNotification = {
  id: "n-1",
  category: "needs-input",
  summary: "Ship it?",
  questions: [{ prompt: "Ship it?", suggestedAnswers: ["yes", "no"] }],
  messageId: "m-1",
  timestamp: 10,
  done: false,
};

function comment(id: string): ConversationAnnotation {
  return { id, selectedText: `passage ${id}`, comment: `comment ${id}`, sourceMessageId: "m-0" };
}

function setPendingComments(annotations: ConversationAnnotation[]) {
  act(() => useStore.getState().setComposerDraft(SESSION, { text: "half-typed message", images: [], annotations }));
}

function renderCard() {
  act(() => applySessionNotifications(SESSION, [notification], {}));
  render(<NotificationMarker sessionId={SESSION} category="needs-input" notificationId="n-1" />);
  fireEvent.click(screen.getByRole("button", { name: "Use suggested answer: yes" }));
  return screen.getByRole("button", { name: "Reply" });
}

const draftComments = () =>
  useStore
    .getState()
    .composerDrafts.get(SESSION)
    ?.annotations?.map((entry) => entry.id);

beforeEach(() => {
  useStore.getState().reset();
  vi.clearAllMocks();
  vi.mocked(api.getNotificationReplies).mockResolvedValue({ replies: [] });
});
afterEach(cleanup);

describe("needs-input card: include my pending comments", () => {
  it("offers no checkbox when there are no pending comments", () => {
    renderCard();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("leaves the box clear by default: only the answer is sent and the comments stay pending", async () => {
    // The user asked for an opt-in: answering a card must not silently consume comments drafted for later.
    vi.mocked(api.sendNeedsInputResponse).mockResolvedValue({ ok: true } as never);
    setPendingComments([comment("a"), comment("b")]);
    const reply = renderCard();

    expect(screen.getByRole("checkbox", { name: "Include my 2 comments" })).not.toBeChecked();
    await act(async () => fireEvent.click(reply));

    expect(vi.mocked(api.sendNeedsInputResponse).mock.calls[0][2]).not.toHaveProperty("annotations");
    expect(draftComments()).toEqual(["a", "b"]);
  });

  it("sends the checked comments with the answer and retires only those it sent", async () => {
    // Comments added while the reply is on its way were not sent, so they must stay pending; the draft's
    // typed text is untouched because only the comments went with the answer.
    let resolve!: (value: unknown) => void;
    vi.mocked(api.sendNeedsInputResponse).mockReturnValue(new Promise((res) => (resolve = res)) as never);
    setPendingComments([comment("a")]);
    const reply = renderCard();

    fireEvent.click(screen.getByRole("checkbox", { name: "Include my comment" }));
    fireEvent.click(reply);
    expect(vi.mocked(api.sendNeedsInputResponse).mock.calls[0][2]).toMatchObject({
      content: expect.stringContaining("yes"),
      annotations: [comment("a")],
    });

    setPendingComments([comment("a"), comment("late")]);
    await act(async () => resolve({ ok: true }));

    expect(draftComments()).toEqual(["late"]);
    expect(useStore.getState().composerDrafts.get(SESSION)?.text).toBe("half-typed message");
    // The box clears after a send, so a later comment is not included unless the user asks again.
    expect(screen.getByRole("checkbox", { name: "Include my comment" })).not.toBeChecked();
  });

  it("keeps the comments pending when the reply fails", async () => {
    vi.mocked(api.sendNeedsInputResponse).mockRejectedValue(new Error("Network down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setPendingComments([comment("a")]);
    const reply = renderCard();

    fireEvent.click(screen.getByRole("checkbox", { name: "Include my comment" }));
    await act(async () => fireEvent.click(reply));

    expect(screen.getByRole("alert")).toHaveTextContent("Reply failed.");
    expect(draftComments()).toEqual(["a"]);
    expect(screen.getByRole("checkbox", { name: "Include my comment" })).toBeChecked();
  });
});
