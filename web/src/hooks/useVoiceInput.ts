import { useState, useRef, useCallback, useEffect } from "react";
import type { VoiceLevelSample } from "../components/composer-voice-types.js";
import type { VoiceRecordingTiming } from "../transcription-progress.js";
import { holdScreenWakeLock } from "../utils/screen-wake-lock.js";
import {
  getVoiceCaptureDeviceId,
  getVoiceCaptureDeviceIds,
  listVoiceMicrophones,
  rememberMicrophone,
  watchVoiceMicrophones,
  type VoiceMicrophone,
  type VoiceMicrophoneSelection,
} from "../utils/voice-microphone.js";
import {
  canRecordThroughVoiceAudioBridge,
  createVoiceAudioBridge,
  type VoiceAudioBridge,
} from "../utils/voice-audio-bridge.js";

/** How often a direct recording's level meter is checked, how slow its clock may run, and how often it may restart. */
const METER_CHECK_MS = 1000;
const METER_MIN_CLOCK_RATE = 0.8;
const MAX_METER_RESTARTS = 5;

export interface UseVoiceInputOptions {
  /** Called with the recorded audio blob when recording stops */
  onAudioReady?: (blob: Blob, timing?: VoiceRecordingTiming) => void;
}

export type TranscriptionPhase =
  | "preparing"
  | "transcribing"
  | "finalizing"
  | "enhancing"
  | "editing"
  | "appending"
  | null;
export type VoiceInputUnsupportedReason =
  | "insecure-context"
  | "missing-media-devices"
  | "missing-media-recorder"
  | "unsupported-environment";

export interface UseVoiceInputReturn {
  isRecording: boolean;
  /** True while acquiring the mic stream before recording actually starts */
  isPreparing: boolean;
  isSupported: boolean;
  unsupportedReason: VoiceInputUnsupportedReason | null;
  unsupportedMessage: string | null;
  isTranscribing: boolean;
  /** Current transcription phase: "preparing", "transcribing", "finalizing", "enhancing"/"editing", or null */
  transcriptionPhase: TranscriptionPhase;
  error: string | null;
  /** Normalized volume level 0–1 while recording, 0 otherwise */
  volumeLevel: number;
  /** Bounded rolling history of recent normalized volume levels while recording */
  volumeHistory: VoiceLevelSample[];
  /** Display name of the microphone being recorded, or null when unknown or not recording */
  inputDeviceLabel: string | null;
  microphoneSelection: VoiceMicrophoneSelection;
  setIsTranscribing: (v: boolean) => void;
  setTranscriptionPhase: (phase: TranscriptionPhase) => void;
  setError: (e: string | null) => void;
  startRecording: () => void;
  stopRecording: () => void;
  /** Cancel recording: stops the mic but discards audio without triggering onAudioReady */
  cancelRecording: () => void;
  toggleRecording: () => void;
  /** Pre-warm the mic stream so startRecording() is near-instant. Safe to call multiple times. */
  warmMicrophone: () => void;
}

const DEFAULT_RECORDING_MIME_TYPE = "audio/webm";
const RECORDING_TIMESLICE_MS = 1000;
const ENCODED_DURATION_PROBE_TIMEOUT_MS = 300;
const VOICE_CAPTURE_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: { ideal: 1 },
  echoCancellation: { ideal: true },
  noiseSuppression: { ideal: true },
  autoGainControl: { ideal: true },
};
const DEFAULT_AUDIO_BITS_PER_SECOND = 32_000;
const MP4_AUDIO_BITS_PER_SECOND = 48_000;
const RECORDER_MIME_TYPE_CANDIDATES = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
] as const;

export function resolveRecordedMimeType(recorderMimeType: string | null | undefined, chunks: Blob[]): string {
  const candidates = [recorderMimeType, ...chunks.map((chunk) => chunk.type)];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed) return trimmed;
  }
  return DEFAULT_RECORDING_MIME_TYPE;
}

export function resolveVoiceRecorderOptions(): MediaRecorderOptions {
  const supportsMimeType =
    typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function"
      ? (mimeType: string) => MediaRecorder.isTypeSupported(mimeType)
      : () => false;
  const preferredMimeType = RECORDER_MIME_TYPE_CANDIDATES.find((mimeType) => supportsMimeType(mimeType));
  return preferredMimeType
    ? {
        mimeType: preferredMimeType,
        audioBitsPerSecond: preferredMimeType.startsWith("audio/mp4")
          ? MP4_AUDIO_BITS_PER_SECOND
          : DEFAULT_AUDIO_BITS_PER_SECOND,
      }
    : { audioBitsPerSecond: DEFAULT_AUDIO_BITS_PER_SECOND };
}

interface VoiceInputSupport {
  isSupported: boolean;
  unsupportedReason: VoiceInputUnsupportedReason | null;
  unsupportedMessage: string | null;
}

export function getVoiceInputSupport(): VoiceInputSupport {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      isSupported: false,
      unsupportedReason: "unsupported-environment",
      unsupportedMessage: "Voice input is unavailable in this environment.",
    };
  }

  if (window.isSecureContext === false) {
    return {
      isSupported: false,
      unsupportedReason: "insecure-context",
      unsupportedMessage: "Voice input requires HTTPS or localhost in this browser.",
    };
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      isSupported: false,
      unsupportedReason: "missing-media-devices",
      unsupportedMessage: "Voice input is unavailable in this browser.",
    };
  }

  if (typeof MediaRecorder === "undefined") {
    return {
      isSupported: false,
      unsupportedReason: "missing-media-recorder",
      unsupportedMessage: "Voice recording is unavailable in this browser.",
    };
  }

  return {
    isSupported: true,
    unsupportedReason: null,
    unsupportedMessage: null,
  };
}

// Meter tuning constants calibrated for speech-level mic input.
const VOLUME_NOISE_FLOOR = 0.01;
const VOLUME_SENSITIVITY = 5.5;
const VOLUME_CURVE = 0.55;
const VOLUME_ATTACK = 0.42;
const VOLUME_RELEASE = 0.14;
export const VOICE_LEVEL_HISTORY_WINDOW_MS = 5_000;
export const VOICE_LEVEL_HISTORY_SAMPLE_INTERVAL_MS = 125;
export const VOICE_LEVEL_HISTORY_MAX_SAMPLES = Math.ceil(
  VOICE_LEVEL_HISTORY_WINDOW_MS / VOICE_LEVEL_HISTORY_SAMPLE_INTERVAL_MS,
);

export function normalizeMeterLevel(rms: number, previousLevel: number): number {
  const gated = Math.max(0, rms - VOLUME_NOISE_FLOOR);
  const boosted = Math.min(1, Math.pow(gated * VOLUME_SENSITIVITY, VOLUME_CURVE));
  const smoothing = boosted > previousLevel ? VOLUME_ATTACK : VOLUME_RELEASE;
  const next = previousLevel + (boosted - previousLevel) * smoothing;
  return Math.max(0, Math.min(1, next));
}

export function appendVoiceLevelHistorySample(
  history: VoiceLevelSample[],
  sample: VoiceLevelSample,
): VoiceLevelSample[] {
  const clampedSample = {
    time: sample.time,
    level: Math.max(0, Math.min(1, sample.level)),
  };
  const oldestTime = clampedSample.time - VOICE_LEVEL_HISTORY_WINDOW_MS;
  const trimmed = history.filter((item) => item.time >= oldestTime);
  return [...trimmed, clampedSample].slice(-VOICE_LEVEL_HISTORY_MAX_SAMPLES);
}

function shouldStoreVoiceLevelHistorySample(timestamp: number, lastSampleTime: number | null): boolean {
  return lastSampleTime === null || timestamp - lastSampleTime >= VOICE_LEVEL_HISTORY_SAMPLE_INTERVAL_MS;
}

type VoiceRecordingStopReason = NonNullable<VoiceRecordingTiming["stopReason"]>;

/** Strips Chrome's "Default - " prefix so the UI names the actual microphone. */
export function formatInputDeviceLabel(label: string | null | undefined): string | null {
  const name = label?.replace(/^Default - /, "").trim();
  return name || null;
}

/** Browsers seen rejecting the exact "default" device, so later requests skip that attempt. */
const mediaDevicesWithoutDefaultDevice = new WeakSet<MediaDevices>();

/**
 * Opens this browser's preferred microphone when available, otherwise the system microphone.
 *
 * Without a device constraint Chrome picks the top mic in its own remembered preference
 * ranking, which can keep recording the built-in mic while the system input is AirPods, and
 * an `ideal` deviceId does not override that ranking. Chrome's "default" device does follow
 * the system input, so request it exactly. Safari and Firefox have no "default" device, reject
 * the exact constraint, and already follow the system input without one.
 *
 * After the first rejection, Safari gets a single request per recording. WebKit treats only
 * the first microphone request of a user gesture as gesture-initiated. Without that, iPhone
 * asks for permission again once the microphone has been idle for over a minute, and after
 * any denial WebKit rejects the request without asking until the page reloads.
 */
export async function requestVoiceCaptureStream(): Promise<MediaStream> {
  const mediaDevices = navigator.mediaDevices;
  for (const deviceId of getVoiceCaptureDeviceIds()) {
    try {
      return await mediaDevices.getUserMedia({
        audio: { ...VOICE_CAPTURE_CONSTRAINTS, deviceId: { exact: deviceId } },
      });
    } catch (error) {
      // A stale browser ID or a device unplugged since enumeration should fall back normally.
      const name = (error as { name?: unknown } | null)?.name;
      if (name !== "OverconstrainedError" && name !== "NotFoundError") throw error;
    }
  }
  if (!mediaDevicesWithoutDefaultDevice.has(mediaDevices)) {
    try {
      return await mediaDevices.getUserMedia({
        audio: { ...VOICE_CAPTURE_CONSTRAINTS, deviceId: { exact: "default" } },
      });
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name !== "OverconstrainedError") throw error;
      mediaDevicesWithoutDefaultDevice.add(mediaDevices);
    }
  }
  return mediaDevices.getUserMedia({ audio: VOICE_CAPTURE_CONSTRAINTS });
}

function formatAudioTrackStates(stream: MediaStream | null | undefined): string | undefined {
  const states =
    stream
      ?.getAudioTracks?.()
      .map((track) => track.readyState)
      .filter(Boolean) ?? [];
  return states.length > 0 ? states.join(",") : undefined;
}

function getAudioTrackMuted(stream: MediaStream | null | undefined): boolean | undefined {
  const tracks = stream?.getAudioTracks?.() ?? [];
  return tracks.length > 0 ? tracks.some((track) => track.muted) : undefined;
}

async function resolveEncodedBlobDurationMs(blob: Blob): Promise<number | undefined> {
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    typeof URL.revokeObjectURL !== "function"
  ) {
    return undefined;
  }

  const url = URL.createObjectURL(blob);
  return await new Promise<number | undefined>((resolve) => {
    const audio = document.createElement("audio");
    let settled = false;
    const finish = (durationMs: number | undefined) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      audio.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(durationMs);
    };
    const timeout = window.setTimeout(() => finish(undefined), ENCODED_DURATION_PROBE_TIMEOUT_MS);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const durationMs =
        Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : undefined;
      finish(durationMs);
    };
    audio.onerror = () => finish(undefined);
    audio.src = url;
  });
}

/** How long to keep a pre-warmed mic stream before releasing it (stops OS mic indicator). */
const STREAM_IDLE_TIMEOUT_MS = 5_000;

export function useVoiceInput(options: UseVoiceInputOptions = {}): UseVoiceInputReturn {
  const support = getVoiceInputSupport();
  const [isRecording, setIsRecording] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionPhase, setTranscriptionPhase] = useState<TranscriptionPhase>(null);
  const [error, setError] = useState<string | null>(null);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [volumeHistory, setVolumeHistory] = useState<VoiceLevelSample[]>([]);
  const [inputDeviceLabel, setInputDeviceLabel] = useState<string | null>(null);
  const [microphoneInputs, setMicrophoneInputs] = useState<VoiceMicrophone[]>([]);
  const captureGenerationRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const recordingTimingRef = useRef<{
    startedAt: number;
    recorderStartedAt?: number;
    stopRequestedAt?: number;
    firstDataAvailableAt?: number;
    lastDataAvailableAt?: number;
    chunkBytes: number;
    chunkCount: number;
    recorderOptions: MediaRecorderOptions;
    stopReason?: VoiceRecordingStopReason;
    recorderStateAtStart?: RecordingState;
    recorderStateAfterStart?: RecordingState;
    recorderStateAtStopRequest?: RecordingState;
    requestDataBeforeStop?: boolean;
    requestDataError?: string;
    audioTrackStatesAtStart?: string;
    audioTrackMutedAtStart?: boolean;
    audioInputLabel?: string;
    trackEndedEventCount: number;
    trackMuteEventCount: number;
    trackUnmuteEventCount: number;
    firstTrackEventAt?: number;
    meterRestarts?: string[];
  } | null>(null);
  const trackListenerCleanupRef = useRef<(() => void) | null>(null);
  const releaseScreenWakeLockRef = useRef<(() => void) | null>(null);

  // Pre-warmed mic stream, kept alive between recordings to avoid getUserMedia latency
  const cachedStreamRef = useRef<MediaStream | null>(null);
  const idleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks an in-flight getUserMedia call from warmMicrophone so startRecording can
  // await it instead of firing a duplicate request (prevents orphaned stream leaks).
  const warmingPromiseRef = useRef<Promise<MediaStream | null> | null>(null);
  const cachedDeviceIdRef = useRef<string | null>(null);

  useEffect(
    () => watchVoiceMicrophones(setMicrophoneInputs, (error) => console.warn("Could not refresh microphones", error)),
    [],
  );

  // Web Audio API refs for volume metering
  const audioBridgeRef = useRef<VoiceAudioBridge | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const meterCheckTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Restarts a direct recording's level meter; set only while one runs. */
  const meterRestartRef = useRef<((reason: string) => void) | null>(null);
  const previousLevelRef = useRef(0);
  const lastHistorySampleTimeRef = useRef<number | null>(null);

  const resetVolumeHistory = useCallback(() => {
    lastHistorySampleTimeRef.current = null;
    setVolumeHistory([]);
  }, []);

  /** Poll the same audio graph that feeds the recorder, so switching keeps the meter current. */
  const startVolumeMonitor = useCallback((analyser: AnalyserNode) => {
    analyserRef.current = analyser;
    previousLevelRef.current = 0;
    const dataArray = new Uint8Array(analyser.fftSize);
    const poll = (timestamp: number = performance.now()) => {
      analyser.getByteTimeDomainData(dataArray);
      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const centered = (dataArray[i] - 128) / 128;
        sumSquares += centered * centered;
      }
      const rms = Math.sqrt(sumSquares / dataArray.length);
      const level = normalizeMeterLevel(rms, previousLevelRef.current);
      previousLevelRef.current = level;
      setVolumeLevel(level);
      if (shouldStoreVoiceLevelHistorySample(timestamp, lastHistorySampleTimeRef.current)) {
        lastHistorySampleTimeRef.current = timestamp;
        setVolumeHistory((history) => appendVoiceLevelHistorySample(history, { time: timestamp, level }));
      }
      animFrameRef.current = requestAnimationFrame(poll);
    };
    animFrameRef.current = requestAnimationFrame(poll);
  }, []);

  /**
   * Meters a recording made straight from the microphone track. Its audio context starts only
   * now, with capture open, so it runs at the audio route the microphone chose (see
   * canRecordThroughVoiceAudioBridge). The recording never waits for it.
   *
   * WebKit can stop that context without stopping the recording: an interruption (a notification
   * sound, Siri) briefly mutes the microphone and leaves the context suspended or interrupted, and a
   * route change after it started leaves it running slower than real time. Either way the meter shows
   * near-silence while the recording is fine. So the meter is checked about once a second, and after
   * the microphone unmutes, and restarted on a fresh context, which picks up the current route.
   */
  const meterDirectRecording = useCallback(
    (stream: MediaStream) => {
      let restarts = 0;
      let lastClock: { contextTime: number; wallTime: number } | null = null;
      const start = () => {
        const meter = createVoiceAudioBridge();
        audioBridgeRef.current = meter;
        lastClock = null;
        if (!meter) return;
        void meter.ready
          .then(async (ready) => {
            if (!ready || audioBridgeRef.current !== meter) return;
            await meter.setInput(stream);
            if (audioBridgeRef.current === meter) startVolumeMonitor(meter.analyser);
          })
          .catch((error) => console.warn("Could not start the microphone level meter", error));
      };
      const restart = (reason: string) => {
        if (restarts >= MAX_METER_RESTARTS || streamRef.current !== stream) return;
        restarts += 1;
        const timing = recordingTimingRef.current;
        if (timing) timing.meterRestarts = [...(timing.meterRestarts ?? []), reason];
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = 0;
        audioBridgeRef.current?.close();
        start();
      };
      const check = () => {
        const context = audioBridgeRef.current?.analyser.context;
        if (!context || !analyserRef.current) return;
        if (context.state !== "running") return restart(`context ${context.state}`);
        const now = { contextTime: context.currentTime, wallTime: performance.now() };
        const previous = lastClock;
        lastClock = now;
        if (!previous || !Number.isFinite(now.contextTime)) return;
        const rate = (now.contextTime - previous.contextTime) / ((now.wallTime - previous.wallTime) / 1000);
        if (rate < METER_MIN_CLOCK_RATE) restart(`clock ${rate.toFixed(2)}`);
      };
      start();
      meterCheckTimerRef.current = setInterval(check, METER_CHECK_MS);
      meterRestartRef.current = restart;
    },
    [startVolumeMonitor],
  );

  /** Stop volume monitoring and clean up Web Audio resources */
  const stopVolumeMonitor = useCallback(() => {
    if (meterCheckTimerRef.current) clearInterval(meterCheckTimerRef.current);
    meterCheckTimerRef.current = null;
    meterRestartRef.current = null;
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    audioBridgeRef.current?.close();
    audioBridgeRef.current = null;
    analyserRef.current = null;
    previousLevelRef.current = 0;
    setVolumeLevel(0);
    resetVolumeHistory();
  }, [resetVolumeHistory]);

  const detachTrackListeners = useCallback(() => {
    trackListenerCleanupRef.current?.();
    trackListenerCleanupRef.current = null;
  }, []);

  const releaseScreenWakeLock = useCallback(() => {
    releaseScreenWakeLockRef.current?.();
    releaseScreenWakeLockRef.current = null;
  }, []);

  const attachTrackListeners = useCallback(
    (stream: MediaStream) => {
      detachTrackListeners();
      const listeners: Array<{ track: MediaStreamTrack; type: "ended" | "mute" | "unmute"; listener: EventListener }> =
        [];
      const recordTrackEvent = (type: "ended" | "mute" | "unmute") => {
        const timing = recordingTimingRef.current;
        if (!timing) return;
        timing.firstTrackEventAt ??= Date.now();
        if (type === "ended") {
          timing.trackEndedEventCount += 1;
          // The bridge track stays live after its hardware source ends. Preserve the old
          // direct-recorder behavior: finish the audio already captured instead of recording silence.
          if (stream === streamRef.current && recorderRef.current?.state === "recording") recorderRef.current.stop();
        } else if (type === "mute") timing.trackMuteEventCount += 1;
        else {
          timing.trackUnmuteEventCount += 1;
          // The interruption that muted the microphone may have stopped the meter's audio context.
          if (stream === streamRef.current) meterRestartRef.current?.("unmute");
        }
      };
      for (const track of stream.getAudioTracks()) {
        for (const type of ["ended", "mute", "unmute"] as const) {
          const listener = () => recordTrackEvent(type);
          track.addEventListener(type, listener);
          listeners.push({ track, type, listener });
        }
      }
      trackListenerCleanupRef.current = () => {
        for (const { track, type, listener } of listeners) {
          track.removeEventListener(type, listener);
        }
      };
    },
    [detachTrackListeners],
  );

  const stopRecorder = useCallback((reason: VoiceRecordingStopReason, requestDataBeforeStop: boolean) => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    const timing = recordingTimingRef.current;
    if (timing) {
      timing.stopReason ??= reason;
      timing.recorderStateAtStopRequest = recorder.state;
      timing.audioTrackStatesAtStart ??= formatAudioTrackStates(streamRef.current);
      timing.audioTrackMutedAtStart ??= getAudioTrackMuted(streamRef.current);
      if (timing.stopRequestedAt === undefined) {
        timing.stopRequestedAt = Date.now();
      }
    }
    if (requestDataBeforeStop && typeof recorder.requestData === "function") {
      try {
        recorder.requestData();
        if (timing) timing.requestDataBeforeStop = true;
      } catch (error) {
        if (timing) timing.requestDataError = error instanceof Error ? error.message : String(error);
      }
    }
    recorder.stop();
  }, []);

  /** Release cached pre-warmed stream and clear idle timeout */
  const releaseCachedStream = useCallback(() => {
    if (idleTimeoutRef.current) {
      clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = null;
    }
    if (cachedStreamRef.current) {
      cachedStreamRef.current.getTracks().forEach((t) => t.stop());
      cachedStreamRef.current = null;
    }
  }, []);

  /** Reset the idle timeout that auto-releases the cached stream */
  const resetIdleTimeout = useCallback(() => {
    if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
    idleTimeoutRef.current = setTimeout(releaseCachedStream, STREAM_IDLE_TIMEOUT_MS);
  }, [releaseCachedStream]);

  /** Check if the cached pre-warmed stream is still usable (has live tracks). */
  function isCachedStreamLive(): boolean {
    const stream = cachedStreamRef.current;
    if (!stream || cachedDeviceIdRef.current !== getVoiceCaptureDeviceId()) return false;
    const tracks = stream.getTracks();
    return tracks.length > 0 && tracks.every((t) => t.readyState === "live");
  }

  /** Pre-warm the microphone stream so startRecording() is near-instant.
   *  Safe to call multiple times -- no-ops if a live stream or in-flight request exists. */
  const warmMicrophone = useCallback(() => {
    if (!support.isSupported) return;
    // Already have a live cached stream or an in-flight warming request
    const deviceId = getVoiceCaptureDeviceId();
    if (isCachedStreamLive() || (warmingPromiseRef.current && cachedDeviceIdRef.current === deviceId)) return;
    releaseCachedStream();
    cachedDeviceIdRef.current = deviceId;

    const promise = requestVoiceCaptureStream()
      .then((stream) => {
        if (warmingPromiseRef.current !== promise || getVoiceCaptureDeviceId() !== deviceId) {
          stream.getTracks().forEach((track) => track.stop());
          return null;
        }
        cachedStreamRef.current = stream;
        resetIdleTimeout();
        return stream;
      })
      .catch(() => {
        // Permission denied or error -- no-op, startRecording will handle it
        return null;
      })
      .finally(() => {
        if (warmingPromiseRef.current === promise) warmingPromiseRef.current = null;
      });
    warmingPromiseRef.current = promise;
  }, [support.isSupported, resetIdleTimeout, releaseCachedStream]);

  const stopRecording = useCallback(() => {
    stopRecorder("manual", true);
  }, [stopRecorder]);

  const cancelRecording = useCallback(() => {
    captureGenerationRef.current += 1;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      cancelledRef.current = true;
      stopRecorder("cancelled", false);
    }
    // Also clear preparing state in case cancel happens during getUserMedia
    setIsPreparing(false);
    if (!recorderRef.current) {
      audioBridgeRef.current?.close();
      audioBridgeRef.current = null;
    }
    releaseScreenWakeLock();
  }, [releaseScreenWakeLock, stopRecorder]);

  const startRecording = useCallback(async () => {
    if (!support.isSupported) {
      setError(support.unsupportedMessage ?? "Voice input is unavailable.");
      return;
    }

    const generation = ++captureGenerationRef.current;
    setError(null);
    chunksRef.current = [];
    cancelledRef.current = false;
    resetVolumeHistory();
    setIsPreparing(true);

    try {
      // If warmMicrophone has an in-flight getUserMedia, await it instead of duplicating
      const warming = cachedDeviceIdRef.current === getVoiceCaptureDeviceId() ? warmingPromiseRef.current : null;
      if (!warming) {
        // A superseded request must release its eventual stream, even if the preference changes back.
        warmingPromiseRef.current = null;
      }

      // Attempt to reuse cached pre-warmed stream, else fall back to fresh getUserMedia
      const cachedStream = isCachedStreamLive() ? cachedStreamRef.current : null;
      if (!cachedStream) releaseCachedStream();
      const streamRequest = warming
        ? warming.then(() => (isCachedStreamLive() ? cachedStreamRef.current! : requestVoiceCaptureStream()))
        : cachedStream
          ? Promise.resolve(cachedStream)
          : requestVoiceCaptureStream();
      // Keep the screen on until recording ends, so a phone's auto-lock can't cut it off. Asked
      // after the microphone, which must be the tap's first request (see requestVoiceCaptureStream),
      // but before awaiting it: WebKit grants the first wake lock only while the tap is recent.
      releaseScreenWakeLockRef.current ??= holdScreenWakeLock();
      const bridge = canRecordThroughVoiceAudioBridge() ? createVoiceAudioBridge() : null;
      audioBridgeRef.current = bridge;
      const stream = await streamRequest;
      const bridgeReady = bridge ? await bridge.ready : false;
      if (generation !== captureGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        bridge?.close();
        return;
      }
      let routed = false;
      if (bridge && bridgeReady) {
        try {
          await bridge.setInput(stream);
          routed = true;
        } catch (error) {
          console.warn("Live microphone switching is unavailable; using direct capture", error);
        }
      }
      if (!routed) {
        bridge?.close();
        audioBridgeRef.current = null;
      }
      void listVoiceMicrophones().then(setMicrophoneInputs, (error) =>
        console.warn("Could not refresh microphones", error),
      );

      // Clear idle timeout -- we're using the stream now
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
        idleTimeoutRef.current = null;
      }
      // Detach from cache -- this recording owns the stream.
      // Prevents stopRecording's track.stop() from killing a shared ref.
      cachedStreamRef.current = null;

      streamRef.current = stream;
      attachTrackListeners(stream);

      // Start volume metering
      const recorderInput = audioBridgeRef.current?.stream ?? stream;
      if (audioBridgeRef.current) startVolumeMonitor(audioBridgeRef.current.analyser);
      else meterDirectRecording(stream);

      const recorderOptions = resolveVoiceRecorderOptions();
      const recorder = new MediaRecorder(recorderInput, recorderOptions);
      recorderRef.current = recorder;
      const audioInputLabel = stream.getAudioTracks()[0]?.label || undefined;
      setInputDeviceLabel(formatInputDeviceLabel(audioInputLabel));
      recordingTimingRef.current = {
        startedAt: Date.now(),
        chunkBytes: 0,
        chunkCount: 0,
        recorderOptions,
        recorderStateAtStart: recorder.state,
        audioTrackStatesAtStart: formatAudioTrackStates(stream),
        audioTrackMutedAtStart: getAudioTrackMuted(stream),
        audioInputLabel,
        trackEndedEventCount: 0,
        trackMuteEventCount: 0,
        trackUnmuteEventCount: 0,
      };

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          const now = Date.now();
          const timing = recordingTimingRef.current;
          if (timing) {
            timing.firstDataAvailableAt ??= now;
            timing.lastDataAvailableAt = now;
            timing.chunkBytes += e.data.size;
            timing.chunkCount += 1;
          }
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blobBuildStartedAt = Date.now();
        const timing = recordingTimingRef.current;
        const audioTrackStatesAtStop = formatAudioTrackStates(streamRef.current);
        const audioTrackMutedAtStop = getAudioTrackMuted(streamRef.current);
        const recorderStateAtStopEvent = recorder.state;
        // Stop volume monitor
        stopVolumeMonitor();
        detachTrackListeners();
        releaseScreenWakeLock();
        // Release mic
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setIsRecording(false);
        setInputDeviceLabel(null);

        // If cancelled, discard audio without triggering transcription
        if (cancelledRef.current) {
          chunksRef.current = [];
          recordingTimingRef.current = null;
          cancelledRef.current = false;
          return;
        }

        if (chunksRef.current.length > 0) {
          const mimeType = resolveRecordedMimeType(recorder.mimeType, chunksRef.current);
          const blob = new Blob(chunksRef.current, { type: mimeType });
          const finalizeRecording = async () => {
            const encodedBlobDurationMs = await resolveEncodedBlobDurationMs(blob);
            const blobReadyAt = Date.now();
            const recordingTiming: VoiceRecordingTiming | undefined = timing
              ? {
                  startedAt: timing.startedAt,
                  ...(timing.recorderStartedAt !== undefined ? { recorderStartedAt: timing.recorderStartedAt } : {}),
                  ...(timing.stopRequestedAt !== undefined ? { stopRequestedAt: timing.stopRequestedAt } : {}),
                  ...(timing.firstDataAvailableAt !== undefined
                    ? { firstDataAvailableAt: timing.firstDataAvailableAt }
                    : {}),
                  ...(timing.lastDataAvailableAt !== undefined
                    ? { lastDataAvailableAt: timing.lastDataAvailableAt }
                    : {}),
                  stopEventAt: blobBuildStartedAt,
                  blobReadyAt,
                  recordingDurationMs:
                    (timing.stopRequestedAt ?? blobBuildStartedAt) - (timing.recorderStartedAt ?? timing.startedAt),
                  ...(timing.stopRequestedAt !== undefined
                    ? { stopToBlobReadyMs: blobReadyAt - timing.stopRequestedAt }
                    : {}),
                  blobBuildDurationMs: blobReadyAt - blobBuildStartedAt,
                  timesliceMs: RECORDING_TIMESLICE_MS,
                  chunkCount: timing.chunkCount,
                  chunkBytes: timing.chunkBytes,
                  blobBytes: blob.size,
                  ...(encodedBlobDurationMs !== undefined ? { encodedBlobDurationMs } : {}),
                  selectedMimeType: timing.recorderOptions.mimeType ?? null,
                  recorderMimeType: recorder.mimeType || null,
                  blobMimeType: blob.type || null,
                  ...(typeof timing.recorderOptions.audioBitsPerSecond === "number"
                    ? { audioBitsPerSecond: timing.recorderOptions.audioBitsPerSecond }
                    : {}),
                  ...(timing.stopReason ? { stopReason: timing.stopReason } : {}),
                  ...(timing.recorderStateAtStart ? { recorderStateAtStart: timing.recorderStateAtStart } : {}),
                  ...(timing.recorderStateAfterStart
                    ? { recorderStateAfterStart: timing.recorderStateAfterStart }
                    : {}),
                  ...(timing.recorderStateAtStopRequest
                    ? { recorderStateAtStopRequest: timing.recorderStateAtStopRequest }
                    : {}),
                  recorderStateAtStopEvent,
                  ...(timing.requestDataBeforeStop !== undefined
                    ? { requestDataBeforeStop: timing.requestDataBeforeStop }
                    : {}),
                  ...(timing.requestDataError !== undefined ? { requestDataError: timing.requestDataError } : {}),
                  ...(timing.audioTrackStatesAtStart !== undefined
                    ? { audioTrackStatesAtStart: timing.audioTrackStatesAtStart }
                    : {}),
                  ...(audioTrackStatesAtStop !== undefined ? { audioTrackStatesAtStop } : {}),
                  ...(timing.audioTrackMutedAtStart !== undefined
                    ? { audioTrackMutedAtStart: timing.audioTrackMutedAtStart }
                    : {}),
                  ...(audioTrackMutedAtStop !== undefined ? { audioTrackMutedAtStop } : {}),
                  ...(timing.audioInputLabel !== undefined ? { audioInputLabel: timing.audioInputLabel } : {}),
                  trackEndedEventCount: timing.trackEndedEventCount,
                  trackMuteEventCount: timing.trackMuteEventCount,
                  trackUnmuteEventCount: timing.trackUnmuteEventCount,
                  ...(timing.firstTrackEventAt !== undefined ? { firstTrackEventAt: timing.firstTrackEventAt } : {}),
                  ...(timing.meterRestarts?.length ? { meterRestarts: timing.meterRestarts.join(", ") } : {}),
                  ...(typeof document !== "undefined" ? { pageVisibility: document.visibilityState } : {}),
                }
              : undefined;
            chunksRef.current = [];
            recordingTimingRef.current = null;
            optionsRef.current.onAudioReady?.(blob, recordingTiming);
          };
          void finalizeRecording();
        }
      };

      recorder.onerror = () => {
        setError("Recording failed");
        if (recordingTimingRef.current) recordingTimingRef.current.stopReason = "error";
        setIsRecording(false);
        setIsPreparing(false);
        setInputDeviceLabel(null);
        stopVolumeMonitor();
        detachTrackListeners();
        releaseScreenWakeLock();
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recorderRef.current = null;
        recordingTimingRef.current = null;
      };

      recorder.start(RECORDING_TIMESLICE_MS);
      if (recordingTimingRef.current) {
        recordingTimingRef.current.recorderStartedAt = Date.now();
        recordingTimingRef.current.recorderStateAfterStart = recorder.state;
      }
      setIsPreparing(false);
      setIsRecording(true);
    } catch (err) {
      if (generation !== captureGenerationRef.current) return;
      setIsPreparing(false);
      stopVolumeMonitor();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      releaseScreenWakeLock();
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("Microphone access denied");
      } else {
        setError("Could not access microphone");
      }
      recordingTimingRef.current = null;
    }
  }, [
    attachTrackListeners,
    detachTrackListeners,
    meterDirectRecording,
    releaseScreenWakeLock,
    releaseCachedStream,
    startVolumeMonitor,
    stopVolumeMonitor,
    support.isSupported,
    support.unsupportedMessage,
  ]);

  const refreshMicrophones = useCallback(async () => {
    setMicrophoneInputs(await listVoiceMicrophones());
  }, []);

  const selectMicrophone = useCallback(
    async (microphone: VoiceMicrophone): Promise<"switched" | "next-recording"> => {
      rememberMicrophone(microphone);
      const recorder = recorderRef.current;
      const bridge = audioBridgeRef.current;
      // A direct recording's bridge only meters it; its recorder cannot change input.
      if (!recorder || recorder.state !== "recording" || !bridge || recorder.stream !== bridge.stream) {
        return "next-recording";
      }
      let next: MediaStream;
      try {
        // This real request is made directly in the pick's click, while the old mic keeps recording.
        next = await navigator.mediaDevices.getUserMedia({
          audio: { ...VOICE_CAPTURE_CONSTRAINTS, deviceId: { exact: microphone.deviceId } },
        });
      } catch (error) {
        console.warn("Could not switch microphone", error);
        throw new Error(
          "Could not open that microphone. Still recording on the current mic; the choice is saved for next time.",
        );
      }
      if (recorderRef.current !== recorder || recorder.state !== "recording" || audioBridgeRef.current !== bridge) {
        next.getTracks().forEach((track) => track.stop());
        return "next-recording";
      }
      try {
        await bridge.setInput(next);
      } catch (error) {
        next.getTracks().forEach((track) => track.stop());
        console.warn("Could not switch the recording input", error);
        return "next-recording";
      }
      if (recorderRef.current !== recorder || recorder.state !== "recording") {
        next.getTracks().forEach((track) => track.stop());
        return "next-recording";
      }
      const previous = streamRef.current;
      streamRef.current = next;
      attachTrackListeners(next);
      previous?.getTracks().forEach((track) => track.stop());
      const label = next.getAudioTracks()[0]?.label;
      setInputDeviceLabel(formatInputDeviceLabel(label));
      const timing = recordingTimingRef.current;
      if (timing && label) timing.audioInputLabel = [timing.audioInputLabel, label].filter(Boolean).join(" → ");
      return "switched";
    },
    [attachTrackListeners],
  );

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      captureGenerationRef.current += 1;
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        stopRecorder("unmount", false);
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      // Release cached pre-warmed stream
      warmingPromiseRef.current = null;
      cachedStreamRef.current?.getTracks().forEach((t) => t.stop());
      cachedStreamRef.current = null;
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
        idleTimeoutRef.current = null;
      }
      stopVolumeMonitor();
      detachTrackListeners();
      releaseScreenWakeLock();
    };
  }, [detachTrackListeners, releaseScreenWakeLock, stopRecorder, stopVolumeMonitor]);

  return {
    isRecording,
    isPreparing,
    isSupported: support.isSupported,
    unsupportedReason: support.unsupportedReason,
    unsupportedMessage: support.unsupportedMessage,
    isTranscribing,
    transcriptionPhase,
    error,
    volumeLevel,
    volumeHistory,
    inputDeviceLabel,
    microphoneSelection: { inputs: microphoneInputs, refresh: refreshMicrophones, select: selectMicrophone },
    setIsTranscribing,
    setTranscriptionPhase,
    setError,
    startRecording,
    stopRecording,
    cancelRecording,
    toggleRecording,
    warmMicrophone,
  };
}
