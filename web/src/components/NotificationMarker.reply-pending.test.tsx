// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const SESSION = "reply-pending";
const notification: SessionNotification = {
  id: "n-1",
  category: "needs-input",
  summary: "Ship it?",
  questions: [{ prompt: "Ship it?", suggestedAnswers: ["yes", "no"] }],
  messageId: "m-1",
  timestamp: 10,
  done: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderCard() {
  act(() => applySessionNotifications(SESSION, [notification], {}));
  render(<NotificationMarker sessionId={SESSION} category="needs-input" notificationId="n-1" />);
  fireEvent.click(screen.getByRole("button", { name: "Use suggested answer: yes" }));
  return screen.getByRole("button", { name: "Reply" });
}

beforeEach(() => {
  useStore.getState().reset();
  vi.clearAllMocks();
  vi.mocked(api.getNotificationReplies).mockResolvedValue({ replies: [] });
});
afterEach(cleanup);

describe("needs-input Reply while the answer is on its way", () => {
  it("shows the button busy and ignores further presses until the server answers", async () => {
    // On a slow connection Reply used to look unpressed for a second and then the card vanished.
    // It must show it is waiting, and a second press must not send the answer twice.
    const response = deferred<{ ok: true }>();
    vi.mocked(api.sendNeedsInputResponse).mockReturnValue(response.promise as never);
    const reply = renderCard();

    fireEvent.click(reply);
    expect(reply).toHaveAttribute("aria-busy", "true");
    fireEvent.click(reply);
    expect(api.sendNeedsInputResponse).toHaveBeenCalledTimes(1);

    await act(async () => response.resolve({ ok: true }));
    expect(reply).not.toHaveAttribute("aria-busy");
    expect(screen.getByLabelText("Answer for Ship it?")).toHaveValue("");
  });

  it("reports a failed delivery and keeps the answer for a retry", async () => {
    // The failure used to be swallowed, leaving a card that silently did nothing.
    vi.mocked(api.sendNeedsInputResponse).mockRejectedValue(new Error("Network down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const reply = renderCard();

    await act(async () => fireEvent.click(reply));
    expect(screen.getByRole("alert")).toHaveTextContent("Reply failed. Network down");
    expect(reply).not.toHaveAttribute("aria-busy");
    expect(screen.getByLabelText("Answer for Ship it?")).toHaveValue("yes");
  });

  it("pops a check beside Answered once this browser's answer lands, and keeps it across remounts", async () => {
    // The feed remounts the card when it turns Answered, so the acknowledgement must not live in card state.
    // It pops in the first time and stays still on later remounts, so scrolling never replays it.
    vi.mocked(api.sendNeedsInputResponse).mockResolvedValue({ ok: true } as never);
    const reply = renderCard();
    await act(async () => fireEvent.click(reply));
    cleanup();
    act(() => applySessionNotifications(SESSION, [{ ...notification, done: true }], {}));
    const answered = () => screen.getByRole("button", { name: "Needs input Handled" });

    const first = render(<NotificationMarker sessionId={SESSION} category="needs-input" notificationId="n-1" />);
    expect(answered().querySelector(".cc-answered-mark")).not.toBeNull();
    first.unmount();
    render(<NotificationMarker sessionId={SESSION} category="needs-input" notificationId="n-1" />);
    expect(answered()).toHaveTextContent("✓");
    expect(answered().querySelector(".cc-answered-mark")).toBeNull();
  });
});
