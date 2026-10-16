// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { SessionTimer } from "../types.js";
import type { SessionWait } from "../../shared/session-waits.js";
import { fingerTap } from "../test-fixtures/finger-tap.js";

// ─── Mock store ──────────────────────────────────────────────────────────────

interface MockStoreState {
  sessionTimers: Map<string, SessionTimer[]>;
  sdkSessions: Array<{ sessionId: string; waits?: SessionWait[] }>;
}

let mockState: MockStoreState;

function resetStore(overrides: Partial<MockStoreState> = {}) {
  mockState = {
    sessionTimers: new Map(),
    sdkSessions: [],
    ...overrides,
  };
}

vi.mock("../store.js", () => ({
  useStore: (selector: (s: MockStoreState) => unknown) => selector(mockState),
}));

// Mock the cancel API so tests don't make real HTTP calls.
vi.mock("../api.js", () => ({
  api: {
    cancelTimer: vi.fn(() => Promise.resolve()),
  },
}));

const { WaitingChip, WaitingPopover } = await import("./WaitingChip.js");
const { api } = await import("../api.js");

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTimer(overrides: Partial<SessionTimer> = {}): SessionTimer {
  return {
    id: "t1",
    sessionId: "s1",
    title: "Check the build status",
    description: "Inspect the latest failing shard if the build is red.",
    type: "delay",
    originalSpec: "30m",
    nextFireAt: Date.now() + 1_800_000, // 30m from now
    createdAt: Date.now() - 600_000,
    fireCount: 0,
    ...overrides,
  };
}

// ─── WaitingChip ─────────────────────────────────────────────────────────────

describe("WaitingChip", () => {
  it("renders nothing when the session waits on nothing", () => {
    // Verifies the chip is invisible without timers or server-reported waits.
    const { container } = render(<WaitingChip sessionId="s1" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders a compact single-timer chip with the clock icon and next fire time", () => {
    // The collapsed chip should stay small: the clock icon and the countdown,
    // not a verbose "N timers" label or the timer's title.
    resetStore({
      sessionTimers: new Map([["s1", [makeTimer()]]]),
    });
    render(<WaitingChip sessionId="s1" />);
    expect(screen.getByText(/^in /)).toBeInTheDocument();
    expect(screen.getByTestId("waiting-chip")).toHaveAttribute("data-wait-kind", "timer");
    expect(screen.queryByText(/\+/)).toBeNull();
    expect(screen.queryByText("1 timer")).toBeNull();
    expect(screen.queryByText(/next in/)).toBeNull();
    expect(screen.queryByText("Check the build status")).toBeNull();
  });

  it("shows the soonest timer plus a count of the others", () => {
    resetStore({
      sessionTimers: new Map([
        [
          "s1",
          [
            makeTimer({ id: "t1", nextFireAt: Date.now() + 60_000 }),
            makeTimer({ id: "t2", nextFireAt: Date.now() + 120_000 }),
          ],
        ],
      ]),
    });
    render(<WaitingChip sessionId="s1" />);
    expect(screen.getByText("in 1:00")).toBeInTheDocument();
    expect(screen.getByText("· +1")).toBeInTheDocument();
  });

  it("shows next fire time from the soonest timer", () => {
    // The chip should display the countdown for the timer that fires soonest,
    // regardless of insertion order.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T09:00:00Z"));
    const soonest = Date.now() + 120_000; // 2m
    const later = Date.now() + 7_200_000; // 2h
    resetStore({
      sessionTimers: new Map([
        ["s1", [makeTimer({ id: "t1", nextFireAt: later }), makeTimer({ id: "t2", nextFireAt: soonest })]],
      ]),
    });
    render(<WaitingChip sessionId="s1" />);
    // New M:SS format: 120s = "2:00"
    expect(screen.getByText("in 2:00")).toBeInTheDocument();
  });

  it("uses an hour-only compact label for multi-hour waits", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T09:00:00Z"));
    resetStore({
      sessionTimers: new Map([["s1", [makeTimer({ nextFireAt: Date.now() + 7_200_000 })]]]),
    });
    render(<WaitingChip sessionId="s1" />);
    expect(screen.getByText("in 2h")).toBeInTheDocument();
    expect(screen.queryByText(/2h 0m/)).toBeNull();
  });

  it("uses a day-only compact label for multi-day waits", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T09:00:00Z"));
    resetStore({
      sessionTimers: new Map([["s1", [makeTimer({ nextFireAt: Date.now() + 172_800_000 })]]]),
    });
    render(<WaitingChip sessionId="s1" />);
    expect(screen.getByText("in 2d")).toBeInTheDocument();
    expect(screen.queryByText(/48h/)).toBeNull();
    expect(screen.queryByText(/2d 0h/)).toBeNull();
  });

  it("rounds a partial day down like the hour label", () => {
    // 1 day 23 hours left reads "1d", not "2d": the chip never shows more time than remains.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T09:00:00Z"));
    resetStore({
      sessionTimers: new Map([["s1", [makeTimer({ nextFireAt: Date.now() + 47 * 3_600_000 })]]]),
    });
    render(<WaitingChip sessionId="s1" />);
    expect(screen.getByText("in 1d")).toBeInTheDocument();
  });

  it("keeps sub-24-hour waits in the hour bucket instead of rounding up to a day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T09:00:00Z"));
    resetStore({
      sessionTimers: new Map([
        [
          "s1",
          [
            makeTimer({ id: "t1", nextFireAt: Date.now() + (23 * 60 + 1) * 60_000 }),
            makeTimer({ id: "t2", nextFireAt: Date.now() + (23 * 60 + 59) * 60_000 }),
          ],
        ],
      ]),
    });
    render(<WaitingChip sessionId="s1" />);
    expect(screen.getByText("in 23h")).toBeInTheDocument();
    expect(screen.queryByText(/1d/)).toBeNull();
  });

  it("opens the timer list on click", () => {
    resetStore({
      sessionTimers: new Map([["s1", [makeTimer()]]]),
    });
    render(<WaitingChip sessionId="s1" />);
    fireEvent.click(screen.getByRole("button"));
    // With only timers, the list is the familiar "Session Timers" list.
    expect(screen.getByText("Session Timers")).toBeInTheDocument();
  });

  it("closes the timer list when the chip is tapped again", () => {
    // The list closes on presses outside it and a tap sends the press before
    // the click, so the chip must count as inside: its tap closes the list
    // instead of closing and reopening it.
    resetStore({ sessionTimers: new Map([["s1", [makeTimer()]]]) });
    vi.useFakeTimers();
    try {
      render(<WaitingChip sessionId="s1" />);
      const chip = screen.getByTestId("waiting-chip");

      fingerTap(chip);
      // Lets the list attach its deferred outside-press listener.
      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByRole("dialog", { name: "Session Timers" })).toBeInTheDocument();

      fingerTap(chip);
      expect(screen.queryByRole("dialog", { name: "Session Timers" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── WaitingPopover ──────────────────────────────────────────────────────────

describe("WaitingPopover", () => {
  it("renders timer title with only the first description line by default", () => {
    // Verifies the anchored timer view separates title from description and collapses
    // the description to its first line for scan-friendly reading.
    const description = "First line summary\nSecond line detail\nThird line detail";
    resetStore({
      sessionTimers: new Map([["s1", [makeTimer({ title: "Check the build status", description })]]]),
    });
    const onClose = vi.fn();
    render(<WaitingPopover sessionId="s1" onClose={onClose} />);
    expect(screen.getByText("Check the build status")).toBeInTheDocument();
    expect(screen.getByText("First line summary")).toBeInTheDocument();
    expect(screen.queryByText("Second line detail")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand timer t1 description" })).toBeInTheDocument();
  });

  it("expands the timer description on demand", () => {
    // Verifies additional detail stays hidden until the user explicitly expands it.
    const description = "First line summary\nSecond line detail";
    resetStore({
      sessionTimers: new Map([["s1", [makeTimer({ description })]]]),
    });
    render(<WaitingPopover sessionId="s1" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Expand timer t1 description" }));

    expect(screen.getByText(/Second line detail/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse timer t1 description" })).toBeInTheDocument();
  });

  it("shows type labels for recurring and at timers, but not for delay", () => {
    // Delay timers only show countdown; recurring/at timers show schedule info.
    resetStore({
      sessionTimers: new Map([
        [
          "s1",
          [
            makeTimer({ id: "t1", type: "delay", originalSpec: "30m" }),
            makeTimer({ id: "t2", type: "recurring", originalSpec: "10m" }),
            makeTimer({ id: "t3", type: "at", originalSpec: "3pm" }),
          ],
        ],
      ]),
    });
    render(<WaitingPopover sessionId="s1" onClose={vi.fn()} />);
    expect(screen.getByText("every 10m")).toBeInTheDocument();
    expect(screen.getByText("at 3pm")).toBeInTheDocument();
    // "delay" type should NOT show "30m" as a schedule label (only as countdown).
    expect(screen.queryByText("30m")).not.toBeInTheDocument();
  });

  it("shows empty state when the session waits on nothing", () => {
    render(<WaitingPopover sessionId="s1" onClose={vi.fn()} />);
    expect(screen.getByText("Not waiting on anything")).toBeInTheDocument();
  });

  it("closes on Escape key", () => {
    resetStore({
      sessionTimers: new Map([["s1", [makeTimer()]]]),
    });
    const onClose = vi.fn();
    render(<WaitingPopover sessionId="s1" onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on outside click", async () => {
    resetStore({
      sessionTimers: new Map([["s1", [makeTimer()]]]),
    });
    const onClose = vi.fn();
    render(<WaitingPopover sessionId="s1" onClose={onClose} />);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when clicking inside the anchored timer view", () => {
    resetStore({
      sessionTimers: new Map([["s1", [makeTimer()]]]),
    });
    const onClose = vi.fn();
    render(<WaitingPopover sessionId="s1" onClose={onClose} />);
    // Tapping the timer title inside the popover should not trigger close.
    fingerTap(screen.getByText("Check the build status"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls cancelTimer API when cancel button is clicked", () => {
    resetStore({
      sessionTimers: new Map([["s1", [makeTimer({ id: "t1" })]]]),
    });
    render(<WaitingPopover sessionId="s1" onClose={vi.fn()} />);
    const cancelBtn = screen.getByTitle("Cancel timer");
    fireEvent.click(cancelBtn);
    expect(api.cancelTimer).toHaveBeenCalledWith("s1", "t1");
  });

  it("shows timer count in header", () => {
    resetStore({
      sessionTimers: new Map([["s1", [makeTimer({ id: "t1" }), makeTimer({ id: "t2" })]]]),
    });
    render(<WaitingPopover sessionId="s1" onClose={vi.fn()} />);
    expect(screen.getByText("(2)")).toBeInTheDocument();
  });
});

// ─── Server-reported waits ───────────────────────────────────────────────────

describe("WaitingChip with server-reported waits", () => {
  // The user saw the green clock on a worker that was waiting on its own
  // background job and looked for a timer. The chip now leads with the wait
  // the server reports first, in that kind's icon, and counts the rest.
  const job: SessionWait = { kind: "job", description: "classify all 1,600 tasks", startedAt: 0 };

  it("leads with a background job and how long it has run, counting a pending timer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T09:00:00Z"));
    resetStore({
      sessionTimers: new Map([["s1", [makeTimer()]]]),
      sdkSessions: [{ sessionId: "s1", waits: [{ ...job, startedAt: Date.now() - 12 * 60_000 }] }],
    });
    render(<WaitingChip sessionId="s1" />);
    expect(screen.getByTestId("waiting-chip")).toHaveAttribute("data-wait-kind", "job");
    expect(screen.getByText("classify all 1,600 tasks")).toBeInTheDocument();
    expect(screen.getByText("· 12m")).toBeInTheDocument();
    expect(screen.getByText("· +1")).toBeInTheDocument();
    expect(screen.queryByText(/^in /)).toBeNull();

    // The run time keeps counting while the chip is shown.
    act(() => vi.advanceTimersByTime(60 * 60_000));
    expect(screen.getByText("· 1h 12m")).toBeInTheDocument();
  });

  it("names a queue wait with its place in line and a landing run", () => {
    resetStore({
      sdkSessions: [
        {
          sessionId: "s1",
          waits: [{ kind: "queue", resource: "dev-server:companion", position: 2 }],
        },
      ],
    });
    const { rerender } = render(<WaitingChip sessionId="s1" />);
    expect(screen.getByTestId("waiting-chip")).toHaveAttribute("data-wait-kind", "queue");
    expect(screen.getByText("dev-server:companion")).toBeInTheDocument();
    expect(screen.getByText("· #2 in line")).toBeInTheDocument();

    resetStore({ sdkSessions: [{ sessionId: "s1", waits: [{ kind: "landing" }] }] });
    rerender(<WaitingChip sessionId="s1" />);
    expect(screen.getByTestId("waiting-chip")).toHaveAttribute("data-wait-kind", "landing");
    expect(screen.getByText("Landing run")).toBeInTheDocument();
  });

  it("lists every wait, server-reported ones first, then the timers with their cancel controls", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T09:00:00Z"));
    resetStore({
      sessionTimers: new Map([["s1", [makeTimer({ id: "t1" })]]]),
      sdkSessions: [
        {
          sessionId: "s1",
          waits: [
            { kind: "answer", questId: "q-7" },
            { ...job, startedAt: Date.now() - 90_000 },
            { kind: "landing" },
            { kind: "queue", resource: "agent-browser", position: 3 },
          ],
        },
      ],
    });
    render(<WaitingChip sessionId="s1" />);
    expect(screen.getByText("Your answer")).toBeInTheDocument();
    expect(screen.getByText("· q-7")).toBeInTheDocument();
    expect(screen.getByText("· +4")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("waiting-chip"));
    const dialog = screen.getByRole("dialog", { name: "Waiting on" });
    expect(screen.getByText("(5)")).toBeInTheDocument();
    expect(
      Array.from(dialog.querySelectorAll('[data-testid="waiting-row"]')).map((row) =>
        row.getAttribute("data-wait-kind"),
      ),
    ).toEqual(["answer", "job", "landing", "queue", "timer"]);
    expect(screen.getByText("Your answer on q-7")).toBeInTheDocument();
    expect(screen.getByText("Background job · running 1m")).toBeInTheDocument();
    expect(screen.getByText("#3 in line")).toBeInTheDocument();
    expect(screen.getByTitle("Cancel timer")).toBeInTheDocument();
  });

  it("shows nothing for another session's waits", () => {
    resetStore({ sdkSessions: [{ sessionId: "other", waits: [job] }] });
    const { container } = render(<WaitingChip sessionId="s1" />);
    expect(container.innerHTML).toBe("");
  });
});
