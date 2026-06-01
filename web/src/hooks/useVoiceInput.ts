import { useState, useRef, useCallback, useEffect } from "react";
import type { VoiceLevelSample } from "../components/composer-voice-types.js";
import type { VoiceRecordingTiming } from "../transcription-progress.js";

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
    trackEndedEventCount: number;
    trackMuteEventCount: number;
    trackUnmuteEventCount: number;
    firstTrackEventAt?: number;
  } | null>(null);
  const trackListenerCleanupRef = useRef<(() => void) | null>(null);

  // Pre-warmed mic stream, kept alive between recordings to avoid getUserMedia latency
  const cachedStreamRef = useRef<MediaStream | null>(null);
  const idleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks an in-flight getUserMedia call from warmMicrophone so startRecording can
  // await it instead of firing a duplicate request (prevents orphaned stream leaks).
  const warmingPromiseRef = useRef<Promise<MediaStream | null> | null>(null);

  // Web Audio API refs for volume metering
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const previousLevelRef = useRef(0);
  const lastHistorySampleTimeRef = useRef<number | null>(null);

  const resetVolumeHistory = useCallback(() => {
    lastHistorySampleTimeRef.current = null;
    setVolumeHistory([]);
  }, []);

  /** Start polling AnalyserNode for volume level */
  const startVolumeMonitor = useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
      audioCtxRef.current = ctx;
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
    } catch {
      // Web Audio API not available — volume will stay at 0
    }
  }, []);

  /** Stop volume monitoring and clean up Web Audio resources */
  const stopVolumeMonitor = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    previousLevelRef.current = 0;
    setVolumeLevel(0);
    resetVolumeHistory();
  }, [resetVolumeHistory]);

  const detachTrackListeners = useCallback(() => {
    trackListenerCleanupRef.current?.();
    trackListenerCleanupRef.current = null;
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
        if (type === "ended") timing.trackEndedEventCount += 1;
        else if (type === "mute") timing.trackMuteEventCount += 1;
        else timing.trackUnmuteEventCount += 1;
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
    if (!stream) return false;
    const tracks = stream.getTracks();
    return tracks.length > 0 && tracks.every((t) => t.readyState === "live");
  }

  /** Pre-warm the microphone stream so startRecording() is near-instant.
   *  Safe to call multiple times -- no-ops if a live stream or in-flight request exists. */
  const warmMicrophone = useCallback(() => {
    if (!support.isSupported) return;
    // Already have a live cached stream or an in-flight warming request
    if (isCachedStreamLive() || warmingPromiseRef.current) return;
    // Clear stale stream ref if tracks ended
    cachedStreamRef.current = null;

    const promise = navigator.mediaDevices
      .getUserMedia({ audio: VOICE_CAPTURE_CONSTRAINTS })
      .then((stream) => {
        cachedStreamRef.current = stream;
        resetIdleTimeout();
        return stream;
      })
      .catch(() => {
        // Permission denied or error -- no-op, startRecording will handle it
        return null;
      })
      .finally(() => {
        warmingPromiseRef.current = null;
      });
    warmingPromiseRef.current = promise;
  }, [support.isSupported, resetIdleTimeout]);

  const stopRecording = useCallback(() => {
    stopRecorder("manual", true);
  }, [stopRecorder]);

  const cancelRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      cancelledRef.current = true;
      stopRecorder("cancelled", false);
    }
    // Also clear preparing state in case cancel happens during getUserMedia
    setIsPreparing(false);
  }, [stopRecorder]);

  const startRecording = useCallback(async () => {
    if (!support.isSupported) {
      setError(support.unsupportedMessage ?? "Voice input is unavailable.");
      return;
    }

    setError(null);
    chunksRef.current = [];
    cancelledRef.current = false;
    resetVolumeHistory();
    setIsPreparing(true);

    try {
      // If warmMicrophone has an in-flight getUserMedia, await it instead of duplicating
      if (warmingPromiseRef.current) {
        await warmingPromiseRef.current;
      }

      // Attempt to reuse cached pre-warmed stream
      let stream: MediaStream | null = isCachedStreamLive() ? cachedStreamRef.current : null;
      if (!stream) {
        cachedStreamRef.current = null;
        // No cached stream available -- fall back to fresh getUserMedia
        stream = await navigator.mediaDevices.getUserMedia({ audio: VOICE_CAPTURE_CONSTRAINTS });
      }

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
      startVolumeMonitor(stream);

      const recorderOptions = resolveVoiceRecorderOptions();
      const recorder = new MediaRecorder(stream, recorderOptions);
      recorderRef.current = recorder;
      recordingTimingRef.current = {
        startedAt: Date.now(),
        chunkBytes: 0,
        chunkCount: 0,
        recorderOptions,
        recorderStateAtStart: recorder.state,
        audioTrackStatesAtStart: formatAudioTrackStates(stream),
        audioTrackMutedAtStart: getAudioTrackMuted(stream),
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
        // Release mic
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setIsRecording(false);

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
                  trackEndedEventCount: timing.trackEndedEventCount,
                  trackMuteEventCount: timing.trackMuteEventCount,
                  trackUnmuteEventCount: timing.trackUnmuteEventCount,
                  ...(timing.firstTrackEventAt !== undefined ? { firstTrackEventAt: timing.firstTrackEventAt } : {}),
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
        stopVolumeMonitor();
        detachTrackListeners();
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
      setIsPreparing(false);
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
    startVolumeMonitor,
    stopVolumeMonitor,
    support.isSupported,
    support.unsupportedMessage,
  ]);

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
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        stopRecorder("unmount", false);
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      // Release cached pre-warmed stream
      cachedStreamRef.current?.getTracks().forEach((t) => t.stop());
      cachedStreamRef.current = null;
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
        idleTimeoutRef.current = null;
      }
      stopVolumeMonitor();
      detachTrackListeners();
    };
  }, [detachTrackListeners, stopRecorder, stopVolumeMonitor]);

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
