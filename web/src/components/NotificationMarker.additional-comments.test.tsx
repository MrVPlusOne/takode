// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api.js";
import { applySessionNotifications } from "../notification-status.js";
import { useStore } from "../store.js";
import type { SessionNotification } from "../types.js";
import { ADDITIONAL_COMMENTS_KEY } from "../utils/notification-questions.js";
import { NotificationMarker } from "./NotificationMarker.js";

vi.mock("../api.js", () => ({
  api: {
    getNotificationReplies: vi.fn(),
    markNotificationDone: vi.fn(),
    sendNeedsInputResponse: vi.fn(),
  },
}));

const SESSION = "additional-comments";
const notification: SessionNotification = {
  id: "n-1",
  category: "needs-input",
  summary: "Rollout choices",
  questions: [
    { prompt: "Which rollout?", suggestedAnswers: ["staged"] },
    { prompt: "When?", suggestedAnswers: ["now"] },
  ],
  messageId: "m-1",
  timestamp: 10,
  done: false,
};

function renderCard() {
  act(() => applySessionNotifications(SESSION, [notification], {}));
  return render(<NotificationMarker sessionId={SESSION} category="needs-input" notificationId="n-1" />);
}

function answerBoth() {
  fireEvent.click(screen.getByRole("button", { name: "Use suggested answer: staged" }));
  fireEvent.click(screen.getByRole("button", { name: "Use suggested answer: now" }));
}

const additionalBox = () => screen.queryByRole("textbox", { name: "Additional comments" });
const draft = () => useStore.getState().needsInputDrafts.get(SESSION)?.get("n-1");

beforeEach(() => {
  useStore.getState().reset();
  vi.clearAllMocks();
  vi.mocked(api.getNotificationReplies).mockResolvedValue({ replies: [] });
});
afterEach(cleanup);

describe("needs-input card: additional comments", () => {
  it("keeps the card compact until asked, then opens a focused box in place of the button", () => {
    renderCard();
    expect(additionalBox()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Additional comments" }));

    expect(additionalBox()).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Additional comments" })).toBeNull();
  });

  it("sends the comments as their own section after the answers, then closes the box", async () => {
    // Before this, the user had to append such remarks to the last question's answer.
    vi.mocked(api.sendNeedsInputResponse).mockResolvedValue({
      ok: true,
    } as never);
    renderCard();
    answerBoth();
    fireEvent.click(screen.getByRole("button", { name: "Additional comments" }));
    fireEvent.change(additionalBox()!, {
      target: { value: "Also update the runbook." },
    });

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reply" })));

    expect(vi.mocked(api.sendNeedsInputResponse).mock.calls[0][2].content).toBe(
      [
        "Answers for: Rollout choices",
        "",
        "1. Which rollout?",
        "   Answer: staged",
        "",
        "2. When?",
        "   Answer: now",
        "",
        "Additional comments:",
        "Also update the runbook.",
      ].join("\n"),
    );
    expect(draft()).toBeUndefined();
    expect(additionalBox()).toBeNull();
  });

  it("does not let additional comments stand in for an unanswered question", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Use suggested answer: staged" }));
    fireEvent.click(screen.getByRole("button", { name: "Additional comments" }));
    fireEvent.change(additionalBox()!, { target: { value: "More later." } });

    expect(screen.getByRole("button", { name: "Reply" })).toBeDisabled();
  });

  it("keeps the comments in the prompt's shared draft, so a remounted card shows them", () => {
    // The draft syncs to the user's other browsers and receives voice results that finish after the card
    // remounted; text arriving there must show the box without another tap.
    const { unmount } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Additional comments" }));
    fireEvent.change(additionalBox()!, { target: { value: "Dictated note" } });
    expect(draft()?.[ADDITIONAL_COMMENTS_KEY]).toBe("Dictated note");

    unmount();
    renderCard();

    expect(additionalBox()).toHaveValue("Dictated note");
    expect(additionalBox()).not.toHaveFocus();
  });

  it("sits beside the include-comments option and both go with the reply", async () => {
    vi.mocked(api.sendNeedsInputResponse).mockResolvedValue({
      ok: true,
    } as never);
    const pending = { id: "c-1", selectedText: "passage", comment: "why?" };
    act(() =>
      useStore.getState().setComposerDraft(SESSION, {
        text: "",
        images: [],
        annotations: [pending],
      }),
    );
    renderCard();
    answerBoth();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include my comment" }));
    fireEvent.click(screen.getByRole("button", { name: "Additional comments" }));
    fireEvent.change(additionalBox()!, { target: { value: "Ship Friday." } });

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reply" })));

    expect(vi.mocked(api.sendNeedsInputResponse).mock.calls[0][2]).toMatchObject({
      content: expect.stringMatching(/\n\nAdditional comments:\nShip Friday\.$/),
      annotations: [pending],
    });
  });
});
