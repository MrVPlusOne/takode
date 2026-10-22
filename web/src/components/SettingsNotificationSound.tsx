import { useEffect, useState } from "react";
import { useStore } from "../store.js";
import type {
  CustomNotificationSoundList,
  CustomNotificationSoundSlot,
} from "../../shared/custom-notification-sounds.js";
import {
  fetchCustomNotificationSounds,
  removeCustomNotificationSound,
  uploadCustomNotificationSound,
} from "../utils/custom-notification-sounds.js";
import {
  CUSTOM_NOTIFICATION_SOUND_SET,
  NOTIFICATION_SOUND_SET_CHOICES,
  toNotificationSoundSetId,
} from "../utils/notification-sound-sets.js";
import { playNeedsInputSound, playReviewSound, previewNotificationSoundSet } from "../utils/notification-sound.js";
import { SettingsRow } from "./settings-controls.js";

const buttonClass =
  "px-2.5 py-1.5 text-sm rounded-md border border-cc-border text-cc-fg hover:bg-cc-active transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default";

/**
 * Picks this device's alert sound set, so people sharing a room can tell
 * whose alert rang. Choosing a set, or tapping Preview, plays both of its sounds.
 * Custom plays the user's own files, uploaded here and kept on the server.
 */
export function NotificationSoundSetSetting({ hidden = false }: { hidden?: boolean }) {
  const soundSet = useStore((s) => s.notificationSoundSet);
  const setSoundSet = useStore((s) => s.setNotificationSoundSet);
  return (
    <div hidden={hidden} className="space-y-2">
      <SettingsRow
        label="Alert Sound"
        htmlFor="notification-sound-set"
        description="Saved on this device. Pick one that differs from people near you."
      >
        <span className="flex items-center gap-2">
          <select
            id="notification-sound-set"
            value={soundSet}
            onChange={(e) => {
              const next = toNotificationSoundSetId(e.target.value);
              setSoundSet(next);
              void previewNotificationSoundSet(next);
            }}
            className="px-2 py-1.5 text-sm bg-cc-input-bg border border-cc-border rounded-md text-cc-fg focus:outline-none focus:border-cc-primary/60"
          >
            {NOTIFICATION_SOUND_SET_CHOICES.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void previewNotificationSoundSet(soundSet)} className={buttonClass}>
            Preview
          </button>
        </span>
      </SettingsRow>
      {soundSet === CUSTOM_NOTIFICATION_SOUND_SET && <CustomSoundFiles />}
    </div>
  );
}

const SLOT_LABELS: Record<CustomNotificationSoundSlot, string> = {
  "needs-input": "Needs you",
  review: "New result",
};

/** Upload, play and remove the two custom sounds. They are shared by every device that picks Custom. */
function CustomSoundFiles() {
  const [sounds, setSounds] = useState<CustomNotificationSoundList | null>(null);
  const [busySlot, setBusySlot] = useState<CustomNotificationSoundSlot | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchCustomNotificationSounds()
      .then(setSounds)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function run(slot: CustomNotificationSoundSlot, action: () => Promise<void>) {
    setBusySlot(slot);
    setError("");
    try {
      await action();
      setSounds(await fetchCustomNotificationSounds());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusySlot(null);
    }
  }

  const play = (slot: CustomNotificationSoundSlot) =>
    slot === "needs-input" ? playNeedsInputSound("custom") : playReviewSound("custom");

  return (
    <div className="px-3 py-2.5 rounded-lg bg-cc-hover text-cc-fg space-y-2">
      <p className="text-xs text-cc-muted">
        Your own audio files, kept on the server for every device that picks Custom. A sound not uploaded plays Classic.
      </p>
      {(["needs-input", "review"] as const).map((slot) => {
        const info = sounds?.[slot] ?? null;
        const busy = busySlot === slot;
        return (
          <div key={slot} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm">{SLOT_LABELS[slot]}</div>
              <div className="truncate text-xs text-cc-muted">{info ? info.name : "Not set"}</div>
            </div>
            <span className="flex items-center gap-2">
              {info && (
                <button type="button" onClick={() => void play(slot)} className={buttonClass}>
                  Play
                </button>
              )}
              <label className={`${buttonClass} ${busy ? "opacity-50" : ""}`}>
                {info ? "Replace" : "Upload"}
                <input
                  type="file"
                  accept="audio/*"
                  aria-label={`Upload ${SLOT_LABELS[slot]} sound`}
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    void run(slot, async () => {
                      await uploadCustomNotificationSound(slot, file);
                      void play(slot);
                    });
                  }}
                />
              </label>
              {info && (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${SLOT_LABELS[slot]} sound`}
                  onClick={() => void run(slot, () => removeCustomNotificationSound(slot))}
                  className={buttonClass}
                >
                  Remove
                </button>
              )}
            </span>
          </div>
        );
      })}
      {error && <p className="text-xs text-cc-error">{error}</p>}
    </div>
  );
}
