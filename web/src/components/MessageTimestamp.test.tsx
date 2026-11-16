// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import {
  InlineMessageTimingVisibilityContext,
  MessageTimeLabel,
  MessageTimestamp,
  formatExactMessageTimestamp,
  formatMessageTimeLabel,
} from "./MessageTimestamp.js";

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(timestamp: number, includeYear = false): string {
  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  });
}

function formatWeekday(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString([], { weekday: "short" });
}

describe("MessageTimestamp", () => {
  beforeEach(() => {
    // Freeze the current local calendar day so the date-boundary labels remain deterministic.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 25, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows only the time for messages from today", () => {
    // Today stays compact so current messages do not become noisier.
    const timestamp = new Date(2026, 6, 25, 17, 22, 0).getTime();

    render(<MessageTimestamp timestamp={timestamp} />);

    expect(screen.getByTestId("message-timestamp").textContent).toBe(formatTime(timestamp));
  });

  it("shows Yesterday plus the time for yesterday's messages", () => {
    // Yesterday needs a friendly day label because time-only text is ambiguous in older feed entries.
    const timestamp = new Date(2026, 6, 24, 17, 22, 0).getTime();

    render(<MessageTimestamp timestamp={timestamp} />);

    expect(screen.getByTestId("message-timestamp").textContent).toBe(`Yesterday ${formatTime(timestamp)}`);
  });

  it("shows the weekday for messages from the past week", () => {
    // Two to six days back, the weekday says how old a message is more directly than a date.
    const sixDaysAgo = new Date(2026, 6, 19, 9, 5, 0).getTime();

    render(<MessageTimestamp timestamp={sixDaysAgo} />);

    expect(screen.getByTestId("message-timestamp").textContent).toBe(
      `${formatWeekday(sixDaysAgo)} ${formatTime(sixDaysAgo)}`,
    );
  });

  it("shows the month and day for older current-year messages", () => {
    // A week or more back, a weekday would be ambiguous, so the date shows without the year.
    const timestamp = new Date(2026, 6, 18, 17, 22, 0).getTime();

    render(<MessageTimestamp timestamp={timestamp} />);

    expect(screen.getByTestId("message-timestamp").textContent).toBe(
      `${formatDate(timestamp)}, ${formatTime(timestamp)}`,
    );
  });

  it("shows the month, day and year for previous-year messages", () => {
    // Prior-year dates include the year so old history cannot be mistaken for this year.
    const timestamp = new Date(2025, 6, 21, 17, 22, 0).getTime();

    render(<MessageTimestamp timestamp={timestamp} />);

    expect(screen.getByTestId("message-timestamp").textContent).toBe(
      `${formatDate(timestamp, true)}, ${formatTime(timestamp)}`,
    );
  });

  it("preserves turn duration after the date-aware timestamp", () => {
    // Duration remains the same trailing metadata, separated from the timestamp label.
    const timestamp = new Date(2026, 6, 24, 17, 22, 0).getTime();

    render(<MessageTimestamp timestamp={timestamp} turnDurationMs={32_000} />);

    expect(screen.getByTestId("message-timestamp").textContent).toBe(`Yesterday ${formatTime(timestamp)} · 32s`);
  });

  it("adds how many days ago to the exact time in the tooltip", () => {
    // Hovering (or the message menu) gives the full date plus its age, so no date arithmetic is needed.
    const timestamp = new Date(2026, 6, 20, 17, 22, 0).getTime();

    expect(formatExactMessageTimestamp(timestamp)).toMatch(/ · 5 days ago$/);
    expect(formatExactMessageTimestamp(new Date(2026, 6, 24, 8, 0, 0).getTime())).toMatch(/ · yesterday$/);
    expect(formatExactMessageTimestamp(new Date(2026, 6, 25, 8, 0, 0).getTime())).toMatch(/ · today$/);
  });

  it("feed labels carry the day too, and move on when the day changes", () => {
    // A tab left open overnight must not keep showing yesterday's messages as bare clock times.
    const timestamp = new Date(2026, 6, 25, 9, 30, 0).getTime();

    render(<MessageTimeLabel id="m1" side="user" timestamp={timestamp} />);
    expect(screen.getByTestId("message-time-label").textContent).toBe(formatTime(timestamp));

    act(() => {
      // From noon to just past midnight: the shared midnight timer fires and labels re-render.
      vi.advanceTimersByTime(12 * 60 * 60 * 1000 + 2000);
    });
    expect(screen.getByTestId("message-time-label").textContent).toBe(`Yesterday ${formatTime(timestamp)}`);
  });

  it("feed labels break only between the day and the time", () => {
    // The time beside a user's message is capped in width; when the label doesn't fit, it must
    // wrap as "Yesterday" / "11:49 PM", never "Yesterday 11:49" / "PM". Each part is its own
    // unbreakable run, and the label reads the same as one string.
    const yesterday = new Date(2026, 6, 24, 23, 49, 0).getTime();
    const older = new Date(2026, 5, 2, 23, 49, 0).getTime();

    render(
      <>
        <MessageTimeLabel id="m1" side="user" timestamp={yesterday} />
        <MessageTimeLabel id="m2" side="user" timestamp={older} />
      </>,
    );
    const [yesterdayLabel, olderLabel] = screen.getAllByTestId("message-time-label");
    const runs = (label: HTMLElement) =>
      [...label.querySelectorAll("span.whitespace-nowrap")].map((span) => span.textContent);

    expect(runs(yesterdayLabel)).toEqual(["Yesterday", formatTime(yesterday)]);
    expect(yesterdayLabel.textContent).toBe(`Yesterday ${formatTime(yesterday)}`);
    expect(runs(olderLabel)).toEqual([expect.stringMatching(/,$/), formatTime(older)]);
    expect(olderLabel.textContent).toBe(formatMessageTimeLabel(older, undefined, Date.now()));
    // Laid out on one line (jsdom puts every box at the top), the date keeps its comma.
    expect(olderLabel.dataset.broken).toBeUndefined();
  });

  it("a date label that breaks marks itself, so its day line drops the comma", () => {
    // index.css hides [data-time-comma] and keeps the day on its own line under [data-broken]:
    // "Jun 2" / "11:49 PM" rather than "Jun 2," / "11:49 PM". Here the time run lays out a line
    // below the day run, as it does when the label is wider than its cap.
    const older = new Date(2026, 5, 2, 23, 49, 0).getTime();
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return new DOMRect(0, this.dataset.timeRun === "time" ? 16 : 0, 50, 16);
    });

    try {
      render(<MessageTimeLabel id="m1" side="user" timestamp={older} />);
      const label = screen.getByTestId("message-time-label");

      expect(label.dataset.broken).toBe("true");
      expect(label.querySelector("[data-time-run=day]")!.textContent).toMatch(/,$/);
      expect(label.querySelector("[data-time-comma]")!.textContent).toBe(",");
    } finally {
      rect.mockRestore();
    }
  });

  it("a label from today is a single unbreakable run", () => {
    const timestamp = new Date(2026, 6, 25, 9, 30, 0).getTime();

    render(<MessageTimeLabel id="m1" side="user" timestamp={timestamp} />);
    const label = screen.getByTestId("message-time-label");

    expect([...label.querySelectorAll("span.whitespace-nowrap")].map((span) => span.textContent)).toEqual([
      formatTime(timestamp),
    ]);
  });

  it("hides inline timing when the feed disables it", () => {
    // Leader feeds suppress both the timestamp and duration without changing the shared timestamp component's default.
    const timestamp = new Date(2026, 6, 25, 17, 22, 0).getTime();

    render(
      <InlineMessageTimingVisibilityContext.Provider value={false}>
        <MessageTimestamp timestamp={timestamp} turnDurationMs={32_000} />
      </InlineMessageTimingVisibilityContext.Provider>,
    );

    expect(screen.queryByTestId("message-timestamp")).toBeNull();
  });
});
