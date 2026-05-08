import { describe, expect, it } from "vitest";
import { getHighestNotificationUrgency } from "./notification-urgency.js";

describe("getHighestNotificationUrgency", () => {
  it("returns null when there are no active notifications", () => {
    // Empty active-notification lists should not produce any urgency.
    expect(getHighestNotificationUrgency(undefined)).toBeNull();
    expect(getHighestNotificationUrgency([])).toBeNull();
  });

  it("returns review when review is the highest active urgency", () => {
    // Review should be returned when it is the only active urgency left.
    expect(getHighestNotificationUrgency([{ category: "review" } as any])).toBe("review");
  });

  it("does not treat waiting as an attention urgency", () => {
    // Waiting is visible status only; it must not create amber or review urgency.
    expect(getHighestNotificationUrgency([{ category: "waiting" } as any])).toBeNull();
  });

  it("gives needs-input precedence over review", () => {
    // needs-input must win whenever it appears alongside active reviews.
    expect(getHighestNotificationUrgency([{ category: "review" } as any, { category: "needs-input" } as any])).toBe(
      "needs-input",
    );
  });
});
