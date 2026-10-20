import { useSyncExternalStore } from "react";
import { fetchReadAloudAudio, reportReadAloudTiming } from "./api/read-aloud.js";

/** The voices offered in the player, in menu order. */
export const READ_ALOUD_PLAYER_VOICES = ["marin", "cedar", "coral", "ash"] as const;
export type ReadAloudVoice = (typeof READ_ALOUD_PLAYER_VOICES)[number];
export const READ_ALOUD_PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const SKIP_SECONDS = 5;
const PREFERENCES_KEY = "cc-read-aloud-preferences";

export interface ReadAloudPreferences {
  voice: ReadAloudVoice;
  playbackRate: number;
}

export interface ReadAloudState {
  messageId: string;
  sessionId: string;
  /** "ready" once audio is loaded, whether playing or paused. */
  status: "preparing" | "ready" | "error";
  error?: string;
}

/** Where the audio is; changes several times a second while playing. */
export interface ReadAloudPlayback {
  currentTime: number;
  duration: number;
  paused: boolean;
}

/**
 * A 10 ms silent WAV. iOS lets a page start audio only inside a tap, and the reply's
 * audio arrives seconds later, so the tap plays this to unlock the shared element.
 */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";

const IDLE_PLAYBACK: ReadAloudPlayback = { currentTime: 0, duration: 0, paused: true };

let state: ReadAloudState | null = null;
let playback: ReadAloudPlayback = IDLE_PLAYBACK;
let preferences: ReadAloudPreferences = loadPreferences();
const listeners = new Set<() => void>();
let audio: HTMLAudioElement | null = null;
/** The current read, from tap until stopped; aborting it cancels its request. */
let currentRead: AbortController | null = null;
/** What the current read asked for, so a voice change can ask again. */
let currentInput: ReadAloudInput | null = null;
let audioUrl: string | null = null;

interface ReadAloudInput {
  sessionId: string;
  messageId: string;
  text: string;
  historyIndex?: number;
}

/**
 * Read one assistant message aloud, replacing anything already playing. Must be called
 * from the tap that asked for it (see SILENT_WAV).
 */
export function startReadAloud(input: ReadAloudInput): void {
  stopReadAloud();
  load(input, 0);
}

/** Stop reading aloud, including a request still being prepared, and close the player. */
export function stopReadAloud(): void {
  currentRead?.abort();
  currentRead = null;
  currentInput = null;
  releaseAudio();
  setState(null);
}

export function toggleReadAloudPause(): void {
  if (!audio || state?.status !== "ready") return;
  if (audio.paused) {
    // Finished: play again from the start.
    if (audio.ended) audio.currentTime = 0;
    audio.play().catch((error: unknown) => console.error("[read-aloud] Could not resume:", error));
  } else {
    audio.pause();
  }
}

export function seekReadAloud(seconds: number): void {
  if (!audio || state?.status !== "ready") return;
  audio.currentTime = Math.min(Math.max(seconds, 0), audio.duration || 0);
  updatePlayback();
}

export function skipReadAloud(direction: -1 | 1): void {
  if (audio) seekReadAloud(audio.currentTime + direction * SKIP_SECONDS);
}

export function setReadAloudPlaybackRate(rate: number): void {
  savePreferences({ ...preferences, playbackRate: rate });
  if (audio) audio.playbackRate = rate;
}

/** Choose the voice for this and later reads; a message being read restarts in the new voice where it was. */
export function setReadAloudVoice(voice: ReadAloudVoice): void {
  if (voice === preferences.voice) return;
  savePreferences({ ...preferences, voice });
  if (!currentInput) return;
  // A finished read starts over; otherwise continue from the same point.
  const resumeFraction = audio?.duration && !audio.ended ? audio.currentTime / audio.duration : 0;
  const input = currentInput;
  currentRead?.abort();
  releaseAudio();
  load(input, resumeFraction);
}

/** Read-aloud state of one message, or null when that message is not being read. */
export function useReadAloudState(messageId: string): ReadAloudState | null {
  return useSyncExternalStore(subscribe, () => (state?.messageId === messageId ? state : null));
}

/** The read the player shows, or null when nothing is being read. */
export function useCurrentReadAloud(): ReadAloudState | null {
  return useSyncExternalStore(subscribe, () => state);
}

export function useReadAloudPlayback(): ReadAloudPlayback {
  return useSyncExternalStore(subscribe, () => playback);
}

export function useReadAloudPreferences(): ReadAloudPreferences {
  return useSyncExternalStore(subscribe, () => preferences);
}

/** Shows a read-aloud state without playing anything, for the Playground. */
export function previewReadAloudState(next: ReadAloudState | null, nextPlayback: ReadAloudPlayback = IDLE_PLAYBACK) {
  stopReadAloud();
  playback = nextPlayback;
  setState(next);
}

function load(input: ReadAloudInput, resumeFraction: number): void {
  const element = getAudioElement();
  element.src = SILENT_WAV;
  // Only unlocks the element; a refusal here shows up when the real audio plays.
  element.play().catch(() => {});

  const request = new AbortController();
  currentRead = request;
  currentInput = input;
  playback = IDLE_PLAYBACK;
  const read = { messageId: input.messageId, sessionId: input.sessionId };
  setState({ ...read, status: "preparing" });
  fetchReadAloudAudio({ ...input, voice: preferences.voice }, request.signal)
    .then(async ({ blob, recordId, cached, waitMs, downloadMs }) => {
      if (currentRead !== request) return;
      const loadedAt = performance.now();
      audioUrl = URL.createObjectURL(blob);
      element.src = audioUrl;
      element.playbackRate = preferences.playbackRate;
      if (resumeFraction > 0) {
        await new Promise((resolve) => element.addEventListener("loadedmetadata", resolve, { once: true }));
        if (currentRead !== request) return;
        element.currentTime = resumeFraction * element.duration;
      }
      await element.play();
      if (recordId)
        reportReadAloudTiming(recordId, { waitMs, downloadMs, startMs: performance.now() - loadedAt, cached });
      setState({ ...read, status: "ready" });
      showOnLockScreen();
    })
    .catch((error: unknown) => {
      if (request.signal.aborted) return;
      console.error("[read-aloud] Failed:", error);
      currentRead = null;
      releaseAudio();
      setState({
        ...read,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

function releaseAudio(): void {
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
  }
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = null;
  playback = IDLE_PLAYBACK;
}

function getAudioElement(): HTMLAudioElement {
  if (audio) return audio;
  const element = new Audio();
  for (const event of ["timeupdate", "durationchange", "play", "pause", "ended", "seeked"]) {
    element.addEventListener(event, () => {
      if (audioUrl && element.src === audioUrl) updatePlayback();
    });
  }
  audio = element;
  return element;
}

function updatePlayback(): void {
  if (!audio) return;
  playback = {
    currentTime: audio.currentTime,
    duration: Number.isFinite(audio.duration) ? audio.duration : 0,
    paused: audio.paused,
  };
  notify();
}

/** Lets the lock screen and Control Center show and control what is playing. */
function showOnLockScreen(): void {
  if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: "Takode reply", artist: "Read aloud" });
  navigator.mediaSession.setActionHandler("stop", stopReadAloud);
  navigator.mediaSession.setActionHandler("seekbackward", () => skipReadAloud(-1));
  navigator.mediaSession.setActionHandler("seekforward", () => skipReadAloud(1));
}

function loadPreferences(): ReadAloudPreferences {
  const defaults: ReadAloudPreferences = { voice: "marin", playbackRate: 1 };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "null") as Partial<ReadAloudPreferences> | null;
    return {
      voice: READ_ALOUD_PLAYER_VOICES.find((voice) => voice === saved?.voice) ?? defaults.voice,
      playbackRate: READ_ALOUD_PLAYBACK_RATES.find((rate) => rate === saved?.playbackRate) ?? defaults.playbackRate,
    };
  } catch {
    // Missing or unreadable preferences fall back to the defaults.
    return defaults;
  }
}

function savePreferences(next: ReadAloudPreferences): void {
  preferences = next;
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
  notify();
}

function setState(next: ReadAloudState | null): void {
  state = next;
  notify();
}

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
