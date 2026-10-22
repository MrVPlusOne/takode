// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_SOUND_SETS, toNotificationSoundSetId } from "./notification-sound-sets.js";
import { playNeedsInputSound, playReviewSound, previewNotificationSoundSet } from "./notification-sound.js";

/** One scheduled oscillator, as the fake AudioContext saw it. */
interface ScheduledNote {
  type: string;
  startFreq: number;
  glideTo: number | null;
  peakGain: number;
  start: number;
}

let scheduled: ScheduledNote[] = [];
/** Start times of decoded (custom) sounds, and how many files were decoded. */
let bufferStarts: number[] = [];
let decodeCount = 0;

/**
 * Minimal Web Audio stand-in recording what each oscillator was told to do,
 * so tests can check which notes a sound schedules without real audio.
 */
class FakeAudioContext {
  state = "running";
  currentTime = 10;
  destination = {};
  createOscillator() {
    const note: ScheduledNote = { type: "", startFreq: 0, glideTo: null, peakGain: 0, start: 0 };
    scheduled.push(note);
    return {
      set type(value: string) {
        note.type = value;
      },
      frequency: {
        setValueAtTime: (value: number) => (note.startFreq = value),
        exponentialRampToValueAtTime: (value: number) => (note.glideTo = value),
      },
      connect: () => undefined,
      start: (at: number) => (note.start = at),
      stop: () => undefined,
    };
  }
  createBufferSource() {
    return {
      buffer: null as unknown,
      connect: () => undefined,
      start: (at: number) => bufferStarts.push(at),
    };
  }
  async decodeAudioData(bytes: ArrayBuffer) {
    decodeCount++;
    return { duration: bytes.byteLength / 10 };
  }
  createGain() {
    const note = scheduled[scheduled.length - 1];
    return {
      gain: {
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: (value: number) => (note.peakGain = value),
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: () => undefined,
    };
  }
}

describe("notification sounds", () => {
  beforeEach(() => {
    scheduled = [];
    bufferStarts = [];
    decodeCount = 0;
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps Classic as the original E5 double-tap and E5 → G5 chime", async () => {
    await playNeedsInputSound("classic");
    expect(scheduled.map((n) => [n.startFreq, n.start])).toEqual([
      [659.25, 10],
      [659.25, 10.3],
    ]);

    scheduled = [];
    await playReviewSound("classic");
    expect(scheduled.map((n) => [n.startFreq, n.start])).toEqual([
      [659.25, 10],
      [783.99, 10.15],
    ]);
  });

  it("plays every set's notes with their waveform, gain and pitch glide", async () => {
    for (const set of NOTIFICATION_SOUND_SETS) {
      scheduled = [];
      await playNeedsInputSound(set.id);
      expect(scheduled).toEqual(
        set.needsInput.map((tone) => ({
          type: tone.type,
          startFreq: tone.freq,
          glideTo: tone.toFreq ?? null,
          peakGain: tone.gain,
          start: 10 + tone.at,
        })),
      );
    }
  });

  it("previews a set by playing its review sound after the needs-input sound ends", async () => {
    const set = NOTIFICATION_SOUND_SETS[NOTIFICATION_SOUND_SETS.length - 1];
    await previewNotificationSoundSet(set.id);

    const needsInputEnd = Math.max(...set.needsInput.map((tone) => tone.at + tone.duration));
    const reviewNotes = scheduled.slice(set.needsInput.length);
    expect(reviewNotes).toHaveLength(set.review.length);
    expect(Math.min(...reviewNotes.map((n) => n.start))).toBeCloseTo(10 + needsInputEnd + 0.5);
  });

  it("falls back to the default set for unknown or missing stored ids", () => {
    expect(toNotificationSoundSetId(null)).toBe("classic");
    expect(toNotificationSoundSetId("retired-set")).toBe("classic");
    for (const set of NOTIFICATION_SOUND_SETS) expect(toNotificationSoundSetId(set.id)).toBe(set.id);
    expect(toNotificationSoundSetId("custom")).toBe("custom");
  });

  it("plays uploaded custom sounds, decoding each file again only when the server's copy changes", async () => {
    let etag = '"1"';
    const fetchMock = vi.fn(async (url: string) => {
      // Ten bytes decode to one second in the fake context.
      const bytes = url.includes("needs-input") ? 20 : 10;
      return new Response(new Uint8Array(bytes), { headers: { ETag: etag } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await previewNotificationSoundSet("custom");
    // Needs-input (2 s) starts now, review half a second after it ends; no synthesized notes.
    expect(bufferStarts).toEqual([10, 12.5]);
    expect(scheduled).toEqual([]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/notification-sounds/needs-input/audio",
      "/api/notification-sounds/review/audio",
    ]);

    await playReviewSound("custom");
    expect(decodeCount).toBe(2);
    etag = '"2"';
    await playReviewSound("custom");
    expect(decodeCount).toBe(3);
  });

  it("plays Classic for a custom sound that was never uploaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );
    await playNeedsInputSound("custom");

    expect(bufferStarts).toEqual([]);
    expect(scheduled.map((n) => n.startFreq)).toEqual([659.25, 659.25]);
  });
});
