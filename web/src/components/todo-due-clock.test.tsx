// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getTodoItemSummaries: vi.fn() }));
vi.mock("../api.js", () => ({ api: mocks }));

import type { TodoItemSummaries, TodoItemSummary } from "../../shared/todo-types.js";
import { TODO_STATE_UPDATED_EVENT } from "../todo-events.js";
import { formatTodoDue } from "./TodoDueControls.js";
import { TodoOverdueBadge } from "./TodoOverdueBadge.js";
import { nextTodoDueChange } from "./todo-due-clock.js";

/** Item summaries as `GET /todos/item-summaries` returns them. */
function summaries(items: Record<string, TodoItemSummary>, revision: number): TodoItemSummaries {
  return { items, proposalItems: {}, revision };
}

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
    // Done and archived to-dos are never overdue, whatever their date.
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(at(13, 59));
    mocks.getTodoItemSummaries.mockResolvedValue(
      summaries(
        {
          "td-1": { status: "todo", due: "2026-10-14" },
          "td-2": { status: "doing", due: "2026-10-15T14:00" },
          "td-3": { status: "todo", due: "2026-10-20" },
          "td-4": { status: "done", due: "2026-10-01" },
          "td-5": { status: "todo", due: "2026-10-01", archivedAt: 1 },
          "td-6": { status: "todo" },
        },
        1,
      ),
    );
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
    mocks.getTodoItemSummaries.mockResolvedValue(summaries({ "td-3": { status: "todo", due: "2026-10-20" } }, 2));
    await act(async () => {
      window.dispatchEvent(new Event(TODO_STATE_UPDATED_EVENT));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByTestId("todo-overdue-badge")).not.toBeInTheDocument();
  });
});
