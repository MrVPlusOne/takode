/** The two alert sounds a custom set can replace: a new needs-input prompt and a tab turning unread. */
export const CUSTOM_NOTIFICATION_SOUND_SLOTS = ["needs-input", "review"] as const;

export type CustomNotificationSoundSlot = (typeof CUSTOM_NOTIFICATION_SOUND_SLOTS)[number];

/** An uploaded custom alert sound, as listed by `GET /api/notification-sounds`. */
export interface CustomNotificationSoundInfo {
  /** The file name it was uploaded with, for display. */
  name: string;
  mimeType: string;
  size: number;
  updatedAt: number;
}

export type CustomNotificationSoundList = Record<CustomNotificationSoundSlot, CustomNotificationSoundInfo | null>;

/** Alert sounds are short; this keeps an accidental song or video from being stored and sent to every browser. */
export const MAX_CUSTOM_NOTIFICATION_SOUND_BYTES = 2 * 1024 * 1024;

export function isCustomNotificationSoundSlot(value: string): value is CustomNotificationSoundSlot {
  return (CUSTOM_NOTIFICATION_SOUND_SLOTS as readonly string[]).includes(value);
}
