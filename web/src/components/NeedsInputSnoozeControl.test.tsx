// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { SessionNotification } from "../types.js";

const mockSnoozeNotification = vi.fn();
const mockSetNotificationMuted = vi.fn();

vi.mock("../api.js", () => ({
  api: {
    snoozeNotification: (...args: unknown[]) => mockSnoozeNotification(...args),
    setNotificationMuted: (...args: unknown[]) => mockSetNotificationMuted(...args),
  },
}));

import { useStore } from "../store.js";
import { formatSnoozeUntil, NeedsInputSnoozeControl } from "./NeedsInputSnoozeControl.js";

const prompt: SessionNotification = {
  id: "n-1",
  category: "needs-input",
  summary: "Pick a plan",
  timestamp: 1000,
  messageId: null,
  done: false,
};

function renderControl(notification: SessionNotification) {
  useStore.setState({ sessionNotifications: new Map([["s1", [notification]]]) });
  return render(<NeedsInputSnoozeControl sessionId="s1" notification={notification} />);
}

function storedNotification(): SessionNotification | undefined {
  return useStore.getState().sessionNotifications.get("s1")?.[0];
}

beforeEach(() => {
  mockSnoozeNotification.mockReset();
  mockSetNotificationMuted.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("NeedsInputSnoozeControl", () => {
  it("snoozes for a preset duration and stores the server-returned prompt", async () => {
    // The server owns the wake time; the browser only sends the chosen duration and stores the reply.
    const snoozed = { ...prompt, muted: true, mutedAt: 2000, snoozedUntil: 3_602_000 };
    mockSnoozeNotification.mockResolvedValue({ ok: true, notification: snoozed });
    renderControl(prompt);

    fireEvent.click(screen.getByRole("button", { name: /Remind me later/ }));
    fireEvent.click(screen.getByRole("button", { name: "1 hour" }));

    await waitFor(() => expect(storedNotification()).toEqual(snoozed));
    expect(mockSnoozeNotification).toHaveBeenCalledWith("s1", "n-1", 3_600_000);
  });

  it("snoozes for a custom number of hours", async () => {
    mockSnoozeNotification.mockResolvedValue({ ok: true, notification: { ...prompt, snoozedUntil: 1 } });
    renderControl(prompt);

    fireEvent.click(screen.getByRole("button", { name: /Remind me later/ }));
    const snoozeButton = within(screen.getByRole("group", { name: "Remind me in" })).getByRole("button", {
      name: "Snooze",
    });
    expect(snoozeButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Custom snooze amount"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Custom snooze unit"), { target: { value: "hours" } });
    fireEvent.click(snoozeButton);

    await waitFor(() => expect(mockSnoozeNotification).toHaveBeenCalledWith("s1", "n-1", 7_200_000));
  });

  it("snoozes until a picked day, at 9 AM unless another time is chosen", async () => {
    // Only Date is faked so waitFor's timers keep running. Sunday Oct 11, 2026, 3 PM local.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 11, 15, 0));
    mockSnoozeNotification.mockResolvedValue({ ok: true, notification: { ...prompt, snoozedUntil: 1 } });
    renderControl(prompt);

    fireEvent.click(screen.getByRole("button", { name: /Remind me later/ }));
    const dayGroup = screen.getByRole("group", { name: "Remind me on" });
    // The picker starts on tomorrow so a single tap snoozes until the next morning.
    expect(screen.getByLabelText("Snooze until day")).toHaveValue("2026-10-12");
    expect(screen.getByLabelText("Snooze until time")).toHaveValue("09:00");
    fireEvent.click(within(dayGroup).getByRole("button", { name: "Snooze" }));

    // Next Monday 9 AM is 18 hours after Sunday 3 PM; the server receives that duration.
    await waitFor(() => expect(mockSnoozeNotification).toHaveBeenCalledWith("s1", "n-1", 18 * 3_600_000));
  });

  it("disables the day snooze outside the server's one-minute to 30-day range", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 11, 15, 0));
    renderControl(prompt);

    fireEvent.click(screen.getByRole("button", { name: /Remind me later/ }));
    const daySnooze = within(screen.getByRole("group", { name: "Remind me on" })).getByRole("button", {
      name: "Snooze",
    });
    // Earlier today has already passed.
    fireEvent.change(screen.getByLabelText("Snooze until day"), { target: { value: "2026-10-11" } });
    expect(daySnooze).toBeDisabled();
    // More than 30 days ahead is refused by the server.
    fireEvent.change(screen.getByLabelText("Snooze until day"), { target: { value: "2026-11-11" } });
    expect(daySnooze).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Snooze until day"), { target: { value: "2026-11-09" } });
    expect(daySnooze).toBeEnabled();
  });

  it("shows when a snoozed prompt returns and cancels the snooze by unmuting it", async () => {
    const snoozed = { ...prompt, muted: true, snoozedUntil: new Date(2026, 9, 7, 20, 15).getTime() };
    mockSetNotificationMuted.mockResolvedValue({ ok: true, notification: prompt });
    renderControl(snoozed);

    expect(screen.getByText(/Snoozed until/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel snooze" }));

    await waitFor(() => expect(storedNotification()).toEqual(prompt));
    expect(mockSetNotificationMuted).toHaveBeenCalledWith("s1", "n-1", false);
  });

  it("reports a failed snooze without changing the stored prompt", async () => {
    mockSnoozeNotification.mockRejectedValue(new Error("Server unreachable"));
    renderControl(prompt);

    fireEvent.click(screen.getByRole("button", { name: /Remind me later/ }));
    fireEvent.click(screen.getByRole("button", { name: "6 hours" }));

    expect(await screen.findByText("Snooze failed. Server unreachable")).toBeInTheDocument();
    expect(storedNotification()).toEqual(prompt);
  });

  it("renders nothing for an answered prompt", () => {
    const { container } = renderControl({ ...prompt, done: true });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("formatSnoozeUntil", () => {
  it("shows only the time for today and adds the weekday for later days", () => {
    const now = new Date(2026, 9, 7, 19, 0).getTime();
    const tonight = new Date(2026, 9, 7, 20, 15).getTime();
    const tomorrow = new Date(2026, 9, 8, 9, 0).getTime();
    expect(formatSnoozeUntil(tonight, now)).not.toMatch(/Thu|Wed/);
    expect(formatSnoozeUntil(tomorrow, now)).toMatch(/^Thu /);
    expect(formatSnoozeUntil(tomorrow, now)).not.toMatch(/Oct/);
  });

  it("adds the date once the weekday alone would be ambiguous", () => {
    // A week or more ahead, "Wed 9:00 AM" could mean this week or next, so the month and day are shown.
    const now = new Date(2026, 9, 7, 19, 0).getTime();
    const nextWeek = new Date(2026, 9, 14, 9, 0).getTime();
    expect(formatSnoozeUntil(nextWeek, now)).toMatch(/^Wed.*Oct.*14/);
  });
});
