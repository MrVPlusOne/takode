import { describe, expect, it, vi } from "vitest";
import { createUserActivityRoutes } from "./user-activity.js";

// The browser reports taps and key presses here; the route only records them for follow-up reminders.
describe("user activity route", () => {
  it("records a browser activity report", async () => {
    const recordUserActivity = vi.fn();
    const app = createUserActivityRoutes({ recordUserActivity });

    const res = await app.request("/user-activity", { method: "POST" });

    expect(res.status).toBe(200);
    expect(recordUserActivity).toHaveBeenCalledTimes(1);
  });
});
