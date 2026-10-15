import { describe, expect, it } from "vitest";
import { isTodoOverdue, isValidTodoDue, todoDueDeadline } from "./todo-due.js";

/** Due dates are local wall-clock values; times here are built in the test's local zone too. */
describe("to-do due dates", () => {
  it("accepts a real date with an optional time and nothing else", () => {
    expect(isValidTodoDue("2026-10-20")).toBe(true);
    expect(isValidTodoDue("2026-10-20T23:59")).toBe(true);
    for (const value of [
      "2026-02-30",
      "2026-13-01",
      "2026-10-20T24:00",
      "2026-10-20T09:60",
      "2026-10-20 09:00",
      "",
      1,
    ]) {
      expect(isValidTodoDue(value), String(value)).toBe(false);
    }
  });

  it("is overdue from the due time, or from the next day for a date alone", () => {
    expect(todoDueDeadline("2026-10-20T14:30")).toBe(new Date(2026, 9, 20, 14, 30).getTime());
    expect(todoDueDeadline("2026-10-20")).toBe(new Date(2026, 9, 21).getTime());
    // Month and year ends roll over.
    expect(todoDueDeadline("2026-12-31")).toBe(new Date(2027, 0, 1).getTime());
  });

  it("counts only current Todo and Doing items as overdue", () => {
    const now = new Date(2026, 9, 21, 8).getTime();
    expect(isTodoOverdue({ due: "2026-10-20", status: "todo" }, now)).toBe(true);
    expect(isTodoOverdue({ due: "2026-10-20", status: "doing" }, now)).toBe(true);
    expect(isTodoOverdue({ due: "2026-10-21", status: "todo" }, now)).toBe(false);
    expect(isTodoOverdue({ due: "2026-10-20", status: "done" }, now)).toBe(false);
    expect(isTodoOverdue({ due: "2026-10-20", status: "todo", archivedAt: 1 }, now)).toBe(false);
    expect(isTodoOverdue({ status: "todo" }, now)).toBe(false);
  });
});
