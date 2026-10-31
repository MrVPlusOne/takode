import { useSyncExternalStore } from "react";
import { fetchReadAloudAudio, reportReadAloudTiming, type ReadAloudAudio } from "./api/read-aloud.js";
import { setLocalStorageItem } from "./utils/scoped-storage.js";

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
  /** While a deck is played: the slide being read (from 0) and how many the deck has. */
  slide?: { index: number; count: number };
}

/** A slide deck to play slide by slide: what each slide says (its notes, else its text) and shows. */
export interface NarratedDeck {
  sessionId: string;
  messageId: string;
  historyIndex?: number;
  title: string;
  slides: ReadonlyArray<{ narration: string; shown: string }>;
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
/** The current read, from tap until stopped; aborting it cancels its requests (a played deck's slides too). */
let currentRead: AbortController | null = null;
/** The audio being loaded; a newer load (another slide, another voice) makes an older one stale. */
let currentLoad: object | null = null;
/** What the current read asked for, so a voice change can ask again. */
let currentInput: ReadAloudInput | null = null;
let audioUrl: string | null = null;
/** The deck being played: its slide, and each slide's audio once asked for (the next is fetched ahead). */
let deck: { narration: NarratedDeck; index: number; audio: Map<number, Promise<ReadAloudAudio>> } | null = null;

interface ReadAloudInput {
  sessionId: string;
  messageId: string;
  text: string;
  historyIndex?: number;
  slide?: { shown: string };
}

/**
 * Read one assistant message aloud, replacing anything already playing. Must be called
 * from the tap that asked for it (see SILENT_WAV).
 */
export function startReadAloud(input: ReadAloudInput): void {
  stopReadAloud();
  currentRead = new AbortController();
  load(input, 0);
}

/**
 * Play a deck from slide `index`: each slide's narration is read aloud, and the next slide starts
 * when one ends. The deck follows `state.slide`. Must be called from the tap that asked for it.
 */
export function playDeck(narration: NarratedDeck, index: number): void {
  stopReadAloud();
  currentRead = new AbortController();
  deck = { narration, index: clampSlide(narration, index), audio: new Map() };
  load(slideInput(deck.index), 0);
}

/** Move a played deck to slide `index` and read it from its start. */
export function goToPlayedSlide(index: number): void {
  if (!deck) return;
  deck.index = clampSlide(deck.narration, index);
  load(slideInput(deck.index), 0);
}

/** Stop playing the deck of `messageId`, when that deck is the one being played. */
export function stopPlayedDeck(messageId: string): void {
  if (deck?.narration.messageId === messageId) stopReadAloud();
}

/** Stop reading aloud, including a request still being prepared, and close the player. */
export function stopReadAloud(): void {
  currentRead?.abort();
  currentRead = null;
  currentLoad = null;
  currentInput = null;
  deck = null;
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
  currentRead = new AbortController();
  deck?.audio.clear();
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
  releaseAudio();
  const element = getAudioElement();
  element.src = SILENT_WAV;
  // Only unlocks the element; a refusal here shows up when the real audio plays.
  element.play().catch(() => {});

  const token = {};
  currentLoad = token;
  currentInput = input;
  const read = {
    messageId: input.messageId,
    sessionId: input.sessionId,
    ...(deck ? { slide: { index: deck.index, count: deck.narration.slides.length } } : {}),
  };
  setState({ ...read, status: "preparing" });
  const audioPromise = deck ? slideAudio(deck.index) : fetchAudio(input);
  audioPromise
    .then(async ({ blob, recordId, cached, waitMs, downloadMs }) => {
      if (currentLoad !== token) return;
      const loadedAt = performance.now();
      audioUrl = URL.createObjectURL(blob);
      element.src = audioUrl;
      element.playbackRate = preferences.playbackRate;
      if (resumeFraction > 0) {
        await new Promise((resolve) => element.addEventListener("loadedmetadata", resolve, { once: true }));
        if (currentLoad !== token) return;
        element.currentTime = resumeFraction * element.duration;
      }
      await element.play();
      if (recordId)
        reportReadAloudTiming(recordId, { waitMs, downloadMs, startMs: performance.now() - loadedAt, cached });
      setState({ ...read, status: "ready" });
      showOnLockScreen();
      // The next slide's audio is made while this one plays, so the deck moves on without a wait.
      if (deck && deck.index + 1 < deck.narration.slides.length) void slideAudio(deck.index + 1).catch(() => {});
    })
    .catch((error: unknown) => {
      if (currentLoad !== token) return;
      console.error("[read-aloud] Failed:", error);
      releaseAudio();
      setState({
        ...read,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

function fetchAudio(input: ReadAloudInput): Promise<ReadAloudAudio> {
  return fetchReadAloudAudio({ ...input, voice: preferences.voice }, currentRead!.signal);
}

/** A played slide's audio, asked for once; a failed request is forgotten so going back to it tries again. */
function slideAudio(index: number): Promise<ReadAloudAudio> {
  const played = deck!;
  const known = played.audio.get(index);
  if (known) return known;
  const audio = fetchAudio(slideInput(index));
  played.audio.set(index, audio);
  audio.catch(() => {
    if (played.audio.get(index) === audio) played.audio.delete(index);
  });
  return audio;
}

function slideInput(index: number): ReadAloudInput {
  const { narration } = deck!;
  const slide = narration.slides[index];
  return {
    sessionId: narration.sessionId,
    messageId: narration.messageId,
    historyIndex: narration.historyIndex,
    text: slide.narration,
    slide: { shown: slide.shown },
  };
}

function clampSlide(narration: NarratedDeck, index: number): number {
  return Math.max(0, Math.min(narration.slides.length - 1, index));
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
  // A played deck moves to its next slide when one ends (the unlocking silence ends too, unnoticed).
  element.addEventListener("ended", () => {
    if (deck && audioUrl && element.src === audioUrl && deck.index + 1 < deck.narration.slides.length)
      goToPlayedSlide(deck.index + 1);
  });
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

/** Lets the lock screen and Control Center show and control what is playing; a played deck skips by slide. */
function showOnLockScreen(): void {
  if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
  const session = navigator.mediaSession;
  session.metadata = deck
    ? new MediaMetadata({
        title: deck.narration.title,
        artist: `Slide ${deck.index + 1} of ${deck.narration.slides.length}`,
      })
    : new MediaMetadata({ title: "Takode reply", artist: "Read aloud" });
  session.setActionHandler("stop", stopReadAloud);
  session.setActionHandler("seekbackward", () => skipReadAloud(-1));
  session.setActionHandler("seekforward", () => skipReadAloud(1));
  try {
    session.setActionHandler("previoustrack", deck ? () => deck && goToPlayedSlide(deck.index - 1) : null);
    session.setActionHandler("nexttrack", deck ? () => deck && goToPlayedSlide(deck.index + 1) : null);
  } catch {
    // Browsers without track actions keep the 5-second skips.
  }
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
  setLocalStorageItem(PREFERENCES_KEY, JSON.stringify(next));
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
