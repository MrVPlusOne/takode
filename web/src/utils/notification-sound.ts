import type { CustomNotificationSoundSlot } from "../../shared/custom-notification-sounds.js";
import { customNotificationSoundUrl } from "./custom-notification-sounds.js";
import {
  CUSTOM_NOTIFICATION_SOUND_SET,
  NOTIFICATION_SOUND_SETS,
  type NotificationSoundSetId,
  type NotificationTone,
} from "./notification-sound-sets.js";

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  // Recreate if the context was closed (browser can close it when tab is
  // backgrounded for extended periods or under memory pressure).
  if (audioContext && audioContext.state !== "closed") {
    return audioContext;
  }
  audioContext = new AudioContext();
  customBuffers.clear();
  return audioContext;
}

/** Plays the set's review sound: a tab newly turned unread. */
export async function playReviewSound(setId: NotificationSoundSetId): Promise<void> {
  await playSound(setId, "review", 0);
}

/** Plays the set's needs-input sound: a new prompt waiting for the user. */
export async function playNeedsInputSound(setId: NotificationSoundSetId): Promise<void> {
  await playSound(setId, "needs-input", 0);
}

/** Plays both sounds of a set, needs-input first, so Settings can preview it. */
export async function previewNotificationSoundSet(setId: NotificationSoundSetId): Promise<void> {
  const needsInputLength = await playSound(setId, "needs-input", 0);
  await playSound(setId, "review", needsInputLength + 0.5);
}

/** Starts one sound `delay` seconds from now and returns its length in seconds. */
async function playSound(
  setId: NotificationSoundSetId,
  slot: CustomNotificationSoundSlot,
  delay: number,
): Promise<number> {
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    if (setId === CUSTOM_NOTIFICATION_SOUND_SET) {
      const buffer = await loadCustomSound(ctx, slot);
      if (buffer) {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(ctx.currentTime + delay);
        return buffer.duration;
      }
    }
    const set = NOTIFICATION_SOUND_SETS.find((s) => s.id === setId) ?? NOTIFICATION_SOUND_SETS[0];
    const tones = slot === "needs-input" ? set.needsInput : set.review;
    const start = ctx.currentTime + delay;
    for (const t of tones) playTone(ctx, t, start + t.at);
    return Math.max(...tones.map((t) => t.at + t.duration));
  } catch {
    // Web Audio API not available
    return 0;
  }
}

/** Decoded custom sounds, kept until the server's copy changes (its ETag). */
const customBuffers = new Map<CustomNotificationSoundSlot, { etag: string; buffer: AudioBuffer }>();

/**
 * The uploaded sound for `slot`, or null when there is none or it cannot be
 * decoded, so the alert still plays Classic. Each alert revalidates with the
 * server, so a new upload plays on every device from its next alert.
 */
async function loadCustomSound(ctx: AudioContext, slot: CustomNotificationSoundSlot): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(customNotificationSoundUrl(slot), { cache: "no-cache" });
    if (!res.ok) return null;
    const etag = res.headers.get("etag") ?? "";
    const cached = customBuffers.get(slot);
    if (cached && etag && cached.etag === etag) return cached.buffer;
    const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    customBuffers.set(slot, { etag, buffer });
    return buffer;
  } catch (err) {
    console.warn(`[notification-sound] Custom ${slot} sound unavailable, playing Classic:`, err);
    return null;
  }
}

function playTone(ctx: AudioContext, t: NotificationTone, start: number): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = t.type;
  osc.frequency.setValueAtTime(t.freq, start);
  if (t.toFreq && t.glide) osc.frequency.exponentialRampToValueAtTime(t.toFreq, start + t.glide);
  g.gain.setValueAtTime(0.001, start);
  g.gain.linearRampToValueAtTime(t.gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, start + t.duration);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + t.duration + 0.05);
}
