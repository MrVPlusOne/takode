import { Hono } from "hono";
import type { NeedsInputReminders } from "../needs-input-reminders.js";

/**
 * The browser reports a tap or key press in a Takode window (at most about once
 * a minute), which counts as user activity and postpones follow-up reminders.
 */
export function createUserActivityRoutes(reminders: Pick<NeedsInputReminders, "recordUserActivity">) {
  const api = new Hono();
  api.post("/user-activity", (c) => {
    reminders.recordUserActivity();
    return c.json({ ok: true });
  });
  return api;
}
