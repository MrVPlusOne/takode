// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MessageTimestamp } from "./MessageTimestamp.js";

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(timestamp: number, includeYear = false): string {
  return new Date(timestamp).toLocaleDateString([], {
    month: "numeric",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  });
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

  it("shows lowercase yesterday plus the time for yesterday's messages", () => {
    // Yesterday needs a friendly day label because time-only text is ambiguous in older feed entries.
    const timestamp = new Date(2026, 6, 24, 17, 22, 0).getTime();

    render(<MessageTimestamp timestamp={timestamp} />);

    expect(screen.getByTestId("message-timestamp").textContent).toBe(`yesterday ${formatTime(timestamp)}`);
  });

  it("shows compact numeric month and day plus the time for earlier current-year messages", () => {
    // Earlier current-year dates get a date hint without spending space on the year.
    const timestamp = new Date(2026, 6, 21, 17, 22, 0).getTime();

    render(<MessageTimestamp timestamp={timestamp} />);

    expect(screen.getByTestId("message-timestamp").textContent).toBe(
      `${formatDate(timestamp)} ${formatTime(timestamp)}`,
    );
  });

  it("shows compact numeric month, day, and year plus the time for previous-year messages", () => {
    // Prior-year dates include the year so old history cannot be mistaken for this year.
    const timestamp = new Date(2025, 6, 21, 17, 22, 0).getTime();

    render(<MessageTimestamp timestamp={timestamp} />);

    expect(screen.getByTestId("message-timestamp").textContent).toBe(
      `${formatDate(timestamp, true)} ${formatTime(timestamp)}`,
    );
  });

  it("preserves turn duration after the date-aware timestamp", () => {
    // Duration remains the same trailing metadata, separated from the timestamp label.
    const timestamp = new Date(2026, 6, 24, 17, 22, 0).getTime();

    render(<MessageTimestamp timestamp={timestamp} turnDurationMs={32_000} />);

    expect(screen.getByTestId("message-timestamp").textContent).toBe(`yesterday ${formatTime(timestamp)} · 32s`);
  });
});
