import { useSyncExternalStore } from "react";
import { openReadAloudStream, reportReadAloudTiming, type ReadAloudStream } from "./api/read-aloud.js";
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
/**
 * The read's audio as it streams in, piece by piece (each a playable MP3), and which piece the
 * audio element holds. Pieces play one after another, so audio starts with the first.
 */
let stream: ReadAloudStream | null = null;
let pieceIndex = 0;
let pieceUrl: string | null = null;
let unsubscribeStream: (() => void) | null = null;
/** A piece ended before the next one arrived: play it as soon as it does (unless paused meanwhile). */
let waitingForPiece = false;
/** The deck being played: its slide, and each slide's audio once asked for (the next is fetched ahead). */
let deck: { narration: NarratedDeck; index: number; audio: Map<number, ReadAloudStream> } | null = null;

interface ReadAloudInput {
  sessionId: string;
  messageId: string;
  text: string;
  historyIndex?: number;
  slide?: { shown: string };
}

/** Where to start playing: a piece and how far into it (0-1), so a voice change resumes in place. */
interface StartPoint {
  piece: number;
  fraction: number;
}

/**
 * Read one assistant message aloud, replacing anything already playing. Must be called
 * from the tap that asked for it (see SILENT_WAV).
 */
export function startReadAloud(input: ReadAloudInput): void {
  stopReadAloud();
  currentRead = new AbortController();
  load(input, { piece: 0, fraction: 0 });
}

/**
 * Play a deck from slide `index`: each slide's narration is read aloud, and the next slide starts
 * when one ends. The deck follows `state.slide`. Must be called from the tap that asked for it.
 */
export function playDeck(narration: NarratedDeck, index: number): void {
  stopReadAloud();
  currentRead = new AbortController();
  deck = { narration, index: clampSlide(narration, index), audio: new Map() };
  load(slideInput(deck.index), { piece: 0, fraction: 0 });
}

/** Move a played deck to slide `index` and read it from its start. */
export function goToPlayedSlide(index: number): void {
  if (!deck) return;
  deck.index = clampSlide(deck.narration, index);
  load(slideInput(deck.index), { piece: 0, fraction: 0 });
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
  if (!audio || !stream || state?.status !== "ready") return;
  if (waitingForPiece) {
    // Paused while the next piece is on its way: it waits instead of starting by itself.
    waitingForPiece = false;
    updatePlayback();
    return;
  }
  if (audio.paused) {
    if (finished()) return playPiece(0, 0);
    // Paused at the end of a piece whose successor has since arrived.
    if (audio.ended && stream.pieces.length > pieceIndex + 1) return playPiece(pieceIndex + 1, 0);
    if (audio.ended) {
      waitingForPiece = true;
      updatePlayback();
      return;
    }
    audio.play().catch((error: unknown) => console.error("[read-aloud] Could not resume:", error));
  } else {
    audio.pause();
  }
}

/** Go to `seconds` into the read, within the audio received so far. */
export function seekReadAloud(seconds: number): void {
  if (!audio || !stream || state?.status !== "ready") return;
  const target = Math.min(Math.max(seconds, 0), stream.seconds);
  let index = 0;
  let before = 0;
  while (index < stream.pieces.length - 1 && before + stream.pieces[index]!.seconds <= target) {
    before += stream.pieces[index]!.seconds;
    index++;
  }
  const offset = Math.min(target - before, stream.pieces[index]!.seconds);
  if (index === pieceIndex) {
    audio.currentTime = offset;
    updatePlayback();
    return;
  }
  playPiece(index, offset, !audio.paused || waitingForPiece);
}

export function skipReadAloud(direction: -1 | 1): void {
  if (audio && stream) seekReadAloud(positionSeconds() + direction * SKIP_SECONDS);
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
  // The text is cut into the same pieces in any voice, so continue in the same piece; a finished read starts over.
  const pieceSeconds = stream?.pieces[pieceIndex]?.seconds ?? 0;
  const start: StartPoint =
    stream && audio && !finished() && pieceSeconds > 0
      ? { piece: pieceIndex, fraction: Math.min(audio.currentTime / pieceSeconds, 1) }
      : { piece: 0, fraction: 0 };
  const input = currentInput;
  currentRead?.abort();
  currentRead = new AbortController();
  deck?.audio.clear();
  load(input, start);
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

function load(input: ReadAloudInput, startAt: StartPoint): void {
  let start = startAt;
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
  const loaded = deck ? slideAudio(deck.index) : openStream(input);
  stream = loaded;
  let started = false;
  let firstPlayMs: number | null = null;
  let timingReported = false;
  const onChange = () => {
    if (currentLoad !== token) return;
    if (!started && loaded.pieces.length > start.piece) {
      started = true;
      const firstPieceAt = performance.now();
      playPiece(start.piece, start.fraction * loaded.pieces[start.piece]!.seconds, true, () => {
        if (currentLoad !== token) return;
        firstPlayMs = performance.now() - firstPieceAt;
        setState({ ...read, status: "ready" });
        showOnLockScreen();
        // The next slide's audio is made while this one plays, so the deck moves on without a wait.
        if (deck && deck.index + 1 < deck.narration.slides.length) slideAudio(deck.index + 1);
        onChange();
      });
      return;
    }
    if (!started && loaded.done && loaded.pieces.length > 0) {
      // The new read has fewer pieces than the point to resume at (a different rewrite): start over.
      start = { piece: 0, fraction: 0 };
      return onChange();
    }
    if (!started && (loaded.error || loaded.done)) {
      console.error("[read-aloud] Failed:", loaded.error);
      releaseAudio();
      setState({ ...read, status: "error", error: loaded.error ?? "Read aloud returned no audio" });
      return;
    }
    if (waitingForPiece && loaded.pieces.length > pieceIndex + 1) {
      waitingForPiece = false;
      playPiece(pieceIndex + 1, 0);
    } else if (waitingForPiece && loaded.error) {
      // Everything received has played; the rest never came.
      console.error("[read-aloud] Failed mid-read:", loaded.error);
      releaseAudio();
      setState({ ...read, status: "error", error: loaded.error });
      return;
    } else if (waitingForPiece && loaded.done) {
      waitingForPiece = false;
      readEnded();
    }
    if (!timingReported && firstPlayMs !== null && loaded.done && loaded.recordId) {
      timingReported = true;
      reportReadAloudTiming(loaded.recordId, {
        waitMs: loaded.waitMs,
        downloadMs: loaded.downloadMs,
        startMs: firstPlayMs,
        cached: loaded.cached,
      });
    }
    updatePlayback();
  };
  unsubscribeStream = loaded.changed(onChange);
  // A deck slide fetched ahead may have arrived already.
  onChange();
}

/** Put piece `index` on the audio element at `offset` seconds, and play it unless asked not to. */
function playPiece(index: number, offset: number, play = true, onPlaying?: () => void): void {
  const element = getAudioElement();
  const piece = stream!.pieces[index]!;
  if (pieceUrl) URL.revokeObjectURL(pieceUrl);
  pieceIndex = index;
  waitingForPiece = false;
  pieceUrl = URL.createObjectURL(piece.blob);
  element.src = pieceUrl;
  element.playbackRate = preferences.playbackRate;
  const token = currentLoad;
  void (async () => {
    if (offset > 0) {
      await new Promise((resolve) => element.addEventListener("loadedmetadata", resolve, { once: true }));
      if (currentLoad !== token) return;
      element.currentTime = offset;
    }
    if (play) await element.play();
    onPlaying?.();
    updatePlayback();
  })().catch((error: unknown) => console.error("[read-aloud] Could not play:", error));
}

/** The element finished a piece: play the next, wait for it, or end the read. */
function pieceEnded(): void {
  if (!stream) return;
  if (stream.pieces.length > pieceIndex + 1) return playPiece(pieceIndex + 1, 0);
  if (stream.done) return readEnded();
  waitingForPiece = true;
  // A read that already failed shows its error now that everything received has played.
  if (stream.error) stream.notify();
  updatePlayback();
}

/** The last piece ended: a played deck moves to its next slide; a message stays at its end. */
function readEnded(): void {
  if (deck && deck.index + 1 < deck.narration.slides.length) return goToPlayedSlide(deck.index + 1);
  updatePlayback();
}

/** The whole read has played to its end. */
function finished(): boolean {
  return !!audio?.ended && !!stream?.done && pieceIndex === stream.pieces.length - 1;
}

function openStream(input: ReadAloudInput): ReadAloudStream {
  return openReadAloudStream({ ...input, voice: preferences.voice }, currentRead!.signal);
}

/** A played slide's audio, asked for once; a failed one is asked for again when it is needed. */
function slideAudio(index: number): ReadAloudStream {
  const played = deck!;
  const known = played.audio.get(index);
  if (known && !known.error) return known;
  const audio = openStream(slideInput(index));
  played.audio.set(index, audio);
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
  if (pieceUrl) URL.revokeObjectURL(pieceUrl);
  pieceUrl = null;
  unsubscribeStream?.();
  unsubscribeStream = null;
  stream = null;
  pieceIndex = 0;
  waitingForPiece = false;
  playback = IDLE_PLAYBACK;
}

function getAudioElement(): HTMLAudioElement {
  if (audio) return audio;
  const element = new Audio();
  for (const event of ["timeupdate", "durationchange", "play", "pause", "seeked"]) {
    element.addEventListener(event, () => {
      if (pieceUrl && element.src === pieceUrl) updatePlayback();
    });
  }
  // A piece ending moves on to the next (the unlocking silence ends too, unnoticed).
  element.addEventListener("ended", () => {
    if (pieceUrl && element.src === pieceUrl) pieceEnded();
  });
  audio = element;
  return element;
}

/** Seconds into the whole read: the pieces before this one, then the element's position. */
function positionSeconds(): number {
  if (!audio || !stream) return 0;
  const before = stream.pieces.slice(0, pieceIndex).reduce((total, piece) => total + piece.seconds, 0);
  return before + audio.currentTime;
}

function updatePlayback(): void {
  if (!audio || !stream) return;
  playback = {
    currentTime: positionSeconds(),
    // Grows as pieces arrive.
    duration: stream.seconds,
    paused: audio.paused && !waitingForPiece,
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
