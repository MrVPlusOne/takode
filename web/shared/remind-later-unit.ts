/**
 * The unit of Remind me later's custom amount ("in N minutes" or "in N hours"). It starts at hours
 * and then follows the user's last choice, kept in the server's settings so every device matches.
 */
export type RemindLaterUnit = "minutes" | "hours";

export const DEFAULT_REMIND_LATER_UNIT: RemindLaterUnit = "hours";

export function normalizeRemindLaterUnit(value: unknown): RemindLaterUnit {
  return value === "minutes" ? "minutes" : DEFAULT_REMIND_LATER_UNIT;
}
