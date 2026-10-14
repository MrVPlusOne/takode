/**
 * Settings for follow-up phone reminders about questions left waiting for the user
 * (see `server/needs-input-reminders.ts`). Shared so Settings shows the same limits
 * the server enforces.
 */
export interface NeedsInputReminderSettings {
  enabled: boolean;
  /** Minutes without user activity before the first reminder; each later gap doubles. */
  inactivityMinutes: number;
  /** Local hour (0-23) quiet hours start; a reminder due then waits until they end. */
  quietStartHour: number;
  /** Local hour (0-23) quiet hours end. Equal start and end means no quiet hours. */
  quietEndHour: number;
  /** Most reminders per local calendar day. */
  dailyMax: number;
}

export const DEFAULT_NEEDS_INPUT_REMINDER_SETTINGS: Readonly<NeedsInputReminderSettings> = {
  enabled: true,
  inactivityMinutes: 120,
  quietStartHour: 23,
  quietEndHour: 9,
  dailyMax: 3,
};

/** Inclusive bounds for each numeric field. */
export const NEEDS_INPUT_REMINDER_LIMITS = {
  inactivityMinutes: { min: 30, max: 24 * 60 },
  quietStartHour: { min: 0, max: 23 },
  quietEndHour: { min: 0, max: 23 },
  dailyMax: { min: 1, max: 10 },
} as const;

type NumericField = keyof typeof NEEDS_INPUT_REMINDER_LIMITS;
const NUMERIC_FIELDS = Object.keys(NEEDS_INPUT_REMINDER_LIMITS) as NumericField[];

function isValidNumber(field: NumericField, value: unknown): value is number {
  const { min, max } = NEEDS_INPUT_REMINDER_LIMITS[field];
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** Stored settings with any missing or invalid field replaced by its default. */
export function normalizeNeedsInputReminderSettings(raw: unknown): NeedsInputReminderSettings {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const result = { ...DEFAULT_NEEDS_INPUT_REMINDER_SETTINGS };
  if (typeof source.enabled === "boolean") result.enabled = source.enabled;
  for (const field of NUMERIC_FIELDS) {
    if (isValidNumber(field, source[field])) result[field] = source[field];
  }
  return result;
}

/**
 * Apply a partial update from the Settings API on top of `current`, or explain
 * which field is invalid. Fields left out keep their current value.
 */
export function applyNeedsInputReminderPatch(
  current: NeedsInputReminderSettings,
  patch: unknown,
): { settings: NeedsInputReminderSettings } | { error: string } {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { error: "needsInputReminders must be an object" };
  }
  const source = patch as Record<string, unknown>;
  const next = { ...current };
  if (source.enabled !== undefined) {
    if (typeof source.enabled !== "boolean") return { error: "needsInputReminders.enabled must be a boolean" };
    next.enabled = source.enabled;
  }
  for (const field of NUMERIC_FIELDS) {
    const value = source[field];
    if (value === undefined) continue;
    if (!isValidNumber(field, value)) {
      const { min, max } = NEEDS_INPUT_REMINDER_LIMITS[field];
      return { error: `needsInputReminders.${field} must be a whole number from ${min} to ${max}` };
    }
    next[field] = value;
  }
  return { settings: next };
}
