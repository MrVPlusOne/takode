// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getTodoDueDates: vi.fn() }));
vi.mock("../api.js", () => ({ api: mocks }));

import { TODO_STATE_UPDATED_EVENT } from "../todo-events.js";
import { formatTodoDue } from "./TodoDueControls.js";
import { TodoOverdueBadge } from "./TodoOverdueBadge.js";
import { nextTodoDueChange } from "./todo-due-clock.js";

/** Local times on Thu Oct 15, 2026; due dates are read in the local zone. */
function at(hour: number, minute = 0, day = 15): number {
  return new Date(2026, 9, day, hour, minute).getTime();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("formatTodoDue", () => {
  it("names nearby days and gives the date otherwise, with the time when set", () => {
    const now = at(10);
    expect(formatTodoDue("2026-10-15", now)).toBe("Today");
    expect(formatTodoDue("2026-10-16T09:00", now)).toMatch(/^Tomorrow 9:00/);
    expect(formatTodoDue("2026-10-14", now)).toBe("Yesterday");
    expect(formatTodoDue("2026-10-19", now)).toBe(
      new Date(2026, 9, 19).toLocaleDateString(undefined, { weekday: "short" }),
    );
    expect(formatTodoDue("2026-10-30", now)).toBe(
      new Date(2026, 9, 30).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    );
    expect(formatTodoDue("2027-01-04", now)).toContain("2027");
  });
});

describe("nextTodoDueChange", () => {
  it("is the next due time to pass, or local midnight when that comes first", () => {
    expect(nextTodoDueChange(["2026-10-15T14:00", "2026-10-15T11:00", "2026-10-14"], at(10))).toBe(at(11));
    // Dates alone turn overdue at a midnight anyway; past due times are ignored.
    expect(nextTodoDueChange(["2026-10-15", "2026-10-15T09:00"], at(10))).toBe(at(0, 0, 16));
  });
});

describe("TodoOverdueBadge", () => {
  it("counts overdue to-dos from their due dates, turning over when a due time passes", async () => {
    // Fake time starts just before 2 PM: one to-do is already overdue and one turns overdue at 2 PM.
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(at(13, 59));
    mocks.getTodoDueDates.mockResolvedValue({ dues: ["2026-10-14", "2026-10-15T14:00", "2026-10-20"], revision: 1 });
    render(<TodoOverdueBadge />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("todo-overdue-badge")).toHaveTextContent("1");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(screen.getByTestId("todo-overdue-badge")).toHaveTextContent("2");

    // A list change reloads the due dates: with none overdue, the badge goes away.
    mocks.getTodoDueDates.mockResolvedValue({ dues: ["2026-10-20"], revision: 2 });
    await act(async () => {
      window.dispatchEvent(new Event(TODO_STATE_UPDATED_EVENT));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByTestId("todo-overdue-badge")).not.toBeInTheDocument();
  });
});
