// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { VoiceLevelSample } from "../components/composer-voice-types.js";
import { listVoiceMicrophones, rememberMicrophone } from "../utils/voice-microphone.js";
import {
  appendVoiceLevelHistorySample,
  getVoiceInputSupport,
  normalizeMeterLevel,
  resolveRecordedMimeType,
  resolveVoiceRecorderOptions,
  requestVoiceCaptureStream,
  VOICE_LEVEL_HISTORY_MAX_SAMPLES,
  VOICE_LEVEL_HISTORY_SAMPLE_INTERVAL_MS,
  VOICE_LEVEL_HISTORY_WINDOW_MS,
  useVoiceInput,
} from "./useVoiceInput.js";

// ── Mocks ──────────────────────────────────────────────────────────────────

/** Create a mock MediaStream with configurable track readyState */
function makeMockStream(trackState: "live" | "ended" = "live", label = ""): MediaStream {
  const listeners = new Map<string, Set<EventListener>>();
  const track = {
    readyState: trackState,
    label,
    stop: vi.fn(),
    kind: "audio",
    id: "mock-track",
    enabled: true,
    muted: false,
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      const set = listeners.get(type) ?? new Set<EventListener>();
      set.add(listener);
      listeners.set(type, set);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    }),
    emit: (type: string) => {
      for (const listener of listeners.get(type) ?? []) {
        listener(new Event(type));
      }
    },
  };
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** Minimal MediaRecorder mock that exposes start/stop controls.
 *  Tracks the last created instance via MockMediaRecorder.lastInstance for tests
 *  that need to trigger error events after recording starts. */
class MockMediaRecorder {
  static lastInstance: MockMediaRecorder | null = null;
  static supportedMimeTypes = new Set<string>();
  static isTypeSupported = vi.fn((mimeType: string) => MockMediaRecorder.supportedMimeTypes.has(mimeType));

  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType = "audio/webm";
  options: MediaRecorderOptions;
  startTimesliceMs?: number;
  requestData = vi.fn(() => {
    if (this.requestDataThrows) throw new Error("requestData failed");
    this.emitData("flush");
  });
  requestDataThrows = false;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(
    readonly stream?: MediaStream,
    options: MediaRecorderOptions = {},
  ) {
    MockMediaRecorder.lastInstance = this;
    this.options = options;
    if (options.mimeType) this.mimeType = options.mimeType;
  }

  start(timeslice?: number) {
    this.startTimesliceMs = timeslice;
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    // Deliver a small data chunk, then fire onstop
    // (matches real browser behavior where onstop fires after ondataavailable)
    this.emitData("tail");
    this.onstop?.();
  }

  emitData(data = "audio", type = "audio/webm") {
    this.ondataavailable?.({ data: new Blob([data], { type }) });
  }

  /** Test helper: simulate a recording error mid-recording */
  triggerError() {
    this.state = "inactive";
    this.onerror?.();
  }
}

/** Stub AudioContext so volume metering setup doesn't throw */
class MockAudioContext {
  static sampleAmplitude = 0;

  state = "running";
  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }
  createMediaStreamDestination() {
    return { stream: makeMockStream("live", "Recording bridge"), channelCount: 2 };
  }
  createGain() {
    return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  }
  createAnalyser() {
    return {
      fftSize: 1024,
      smoothingTimeConstant: 0,
      getByteTimeDomainData: vi.fn((array: Uint8Array) => {
        for (let i = 0; i < array.length; i += 1) {
          array[i] = 128 + (i % 2 === 0 ? MockAudioContext.sampleAmplitude : -MockAudioContext.sampleAmplitude);
        }
      }),
    };
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

let getUserMediaMock: ReturnType<typeof vi.fn>;

// jsdom's user agent looks like WebKit, which records without the live-switching bridge.
const CHROME_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const IPHONE_SAFARI_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1";

// Volume monitor uses requestAnimationFrame/cancelAnimationFrame which may not exist in jsdom.
// Define them once at module level so they survive through React cleanup (unmount) which
// fires stopVolumeMonitor -> cancelAnimationFrame after the test's afterEach runs.
if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (() => 1) as typeof globalThis.requestAnimationFrame;
}
if (typeof globalThis.cancelAnimationFrame === "undefined") {
  globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();

  getUserMediaMock = vi.fn().mockResolvedValue(makeMockStream());
  MockAudioContext.sampleAmplitude = 0;
  MockMediaRecorder.lastInstance = null;
  MockMediaRecorder.supportedMimeTypes = new Set([
    "audio/mp4;codecs=mp4a.40.2",
    "audio/webm;codecs=opus",
    "audio/webm",
  ]);
  MockMediaRecorder.isTypeSupported.mockClear();

  Object.defineProperty(navigator, "userAgent", { configurable: true, value: CHROME_USER_AGENT });
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: getUserMediaMock,
      enumerateDevices: vi.fn().mockResolvedValue([]),
    },
  });
  vi.stubGlobal("MediaRecorder", MockMediaRecorder);
  vi.stubGlobal("AudioContext", MockAudioContext);
});

afterEach(() => {
  // Unmount while fake timers are still installed. Testing Library's own cleanup runs after this hook,
  // so a hook still recording would stop on unmount and start its 300 ms duration probe on a real
  // timer, which fired after jsdom teardown ("window is not defined") when the worker stayed busy.
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Pure function tests (existing) ─────────────────────────────────────────

describe("normalizeMeterLevel", () => {
  it("keeps silence at zero", () => {
    expect(normalizeMeterLevel(0, 0)).toBe(0);
  });

  it("filters low-level background noise near the floor", () => {
    expect(normalizeMeterLevel(0.009, 0)).toBe(0);
  });

  it("boosts speech-like RMS values for a responsive meter", () => {
    const level = normalizeMeterLevel(0.05, 0);
    expect(level).toBeGreaterThan(0.1);
    expect(level).toBeLessThan(0.35);
  });

  it("uses slower release smoothing so bars do not snap to zero", () => {
    const rising = normalizeMeterLevel(0.12, 0);
    const falling = normalizeMeterLevel(0, rising);
    expect(rising).toBeGreaterThan(0.25);
    expect(falling).toBeGreaterThan(0.2);
    expect(falling).toBeLessThan(rising);
  });
});

describe("appendVoiceLevelHistorySample", () => {
  it("keeps a bounded 5 second window and clamps levels for rendering", () => {
    // The rolling trace should be small enough for the composer status row and
    // should never grow with every animation frame over a long recording.
    let history: VoiceLevelSample[] = [];

    for (let i = 0; i <= VOICE_LEVEL_HISTORY_MAX_SAMPLES + 6; i += 1) {
      history = appendVoiceLevelHistorySample(history, {
        time: i * VOICE_LEVEL_HISTORY_SAMPLE_INTERVAL_MS,
        level: i % 2 === 0 ? 1.4 : -0.2,
      });
    }

    expect(history).toHaveLength(VOICE_LEVEL_HISTORY_MAX_SAMPLES);
    expect(history[0].time).toBeGreaterThanOrEqual(history[history.length - 1].time - VOICE_LEVEL_HISTORY_WINDOW_MS);
    expect(history.every((sample) => sample.level >= 0 && sample.level <= 1)).toBe(true);
  });
});

describe("getVoiceInputSupport", () => {
  it("reports insecure contexts explicitly instead of hiding voice input", () => {
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: false,
    });

    expect(getVoiceInputSupport()).toEqual({
      isSupported: false,
      unsupportedReason: "insecure-context",
      unsupportedMessage: "Voice input requires HTTPS or localhost in this browser.",
    });
  });

  it("reports full support when browser recording APIs are available", () => {
    expect(getVoiceInputSupport()).toEqual({
      isSupported: true,
      unsupportedReason: null,
      unsupportedMessage: null,
    });
  });
});

describe("resolveRecordedMimeType", () => {
  it("prefers the recorder mime type when the browser provides one", () => {
    const chunks = [new Blob(["data"], { type: "audio/webm" })];
    expect(resolveRecordedMimeType("audio/mp4", chunks)).toBe("audio/mp4");
  });

  it("falls back to the first chunk mime type when recorder.mimeType is empty", () => {
    const chunks = [new Blob(["data"], { type: "audio/ogg" })];
    expect(resolveRecordedMimeType("", chunks)).toBe("audio/ogg");
  });

  it("defaults to audio/webm when no type is available anywhere", () => {
    const chunks = [new Blob(["data"])];
    expect(resolveRecordedMimeType("", chunks)).toBe("audio/webm");
  });
});

describe("resolveVoiceRecorderOptions", () => {
  it("prefers Safari-friendly mp4 when the browser reports support", () => {
    expect(resolveVoiceRecorderOptions()).toEqual({
      mimeType: "audio/mp4;codecs=mp4a.40.2",
      audioBitsPerSecond: 48_000,
    });
  });

  it("falls back to bitrate-only recording when no preferred mime type is supported", () => {
    MockMediaRecorder.supportedMimeTypes = new Set();

    expect(resolveVoiceRecorderOptions()).toEqual({
      audioBitsPerSecond: 32_000,
    });
  });
});

// ── Hook tests: isPreparing transitions ────────────────────────────────────

describe("useVoiceInput — isPreparing", () => {
  it("isPreparing is true while getUserMedia is pending, then false once recording starts", async () => {
    // Make getUserMedia hang until we resolve it manually
    let resolveStream!: (stream: MediaStream) => void;
    getUserMediaMock.mockImplementation(
      () =>
        new Promise<MediaStream>((r) => {
          resolveStream = r;
        }),
    );

    const { result } = renderHook(() => useVoiceInput());

    expect(result.current.isPreparing).toBe(false);
    expect(result.current.isRecording).toBe(false);

    // Start recording -- should immediately set isPreparing
    act(() => {
      result.current.startRecording();
    });
    // isPreparing goes true synchronously in the same microtask as the setState
    expect(result.current.isPreparing).toBe(true);
    expect(result.current.isRecording).toBe(false);

    // Resolve getUserMedia -- recording should start and isPreparing should clear
    await act(async () => {
      resolveStream(makeMockStream());
    });
    expect(result.current.isPreparing).toBe(false);
    expect(result.current.isRecording).toBe(true);
  });

  it("isPreparing clears when getUserMedia rejects (permission denied)", async () => {
    getUserMediaMock.mockRejectedValue(new DOMException("Not allowed", "NotAllowedError"));

    const { result } = renderHook(() => useVoiceInput());

    await act(async () => {
      result.current.startRecording();
    });

    expect(result.current.isPreparing).toBe(false);
    expect(result.current.isRecording).toBe(false);
    expect(result.current.error).toBe("Microphone access denied");
  });

  it("cancelRecording clears isPreparing during the preparing phase", async () => {
    // Make getUserMedia hang forever
    getUserMediaMock.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useVoiceInput());

    act(() => {
      result.current.startRecording();
    });
    expect(result.current.isPreparing).toBe(true);

    // Cancel while still preparing (before getUserMedia resolves)
    act(() => {
      result.current.cancelRecording();
    });
    expect(result.current.isPreparing).toBe(false);
    expect(result.current.isRecording).toBe(false);
  });

  it("requests mono speech-friendly audio constraints and recorder options", async () => {
    const { result } = renderHook(() => useVoiceInput());

    await act(async () => {
      result.current.startRecording();
    });

    expect(getUserMediaMock).toHaveBeenCalledWith({
      audio: {
        // Chrome's "default" device follows the system input instead of Chrome's own mic ranking.
        deviceId: { exact: "default" },
        channelCount: { ideal: 1 },
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
      },
    });
    expect(MockMediaRecorder.lastInstance?.options).toEqual({
      mimeType: "audio/mp4;codecs=mp4a.40.2",
      audioBitsPerSecond: 48_000,
    });
  });
});

describe("requestVoiceCaptureStream", () => {
  it("requests the saved microphone synchronously without a permission probe", async () => {
    // A real request in the tap preserves Safari gesture privilege and bypasses Chrome's mic ranking.
    rememberMicrophone({ deviceId: "usb", label: "External microphone" });
    const request = requestVoiceCaptureStream();
    expect(getUserMediaMock).toHaveBeenCalledExactlyOnceWith({
      audio: expect.objectContaining({ deviceId: { exact: "usb" } }),
    });
    await request;
  });

  it.each(["OverconstrainedError", "NotFoundError"])("falls back when a saved device disappears (%s)", async (name) => {
    // Handles unplugging between enumeration and capture, as well as IDs invalidated by the browser.
    rememberMicrophone({ deviceId: "usb", label: "External microphone" });
    getUserMediaMock.mockRejectedValueOnce(new DOMException("Device unavailable", name));
    await expect(requestVoiceCaptureStream()).resolves.toBeDefined();
    expect(getUserMediaMock).toHaveBeenNthCalledWith(2, {
      audio: expect.objectContaining({ deviceId: { exact: "default" } }),
    });
  });

  it("uses a single request when the device list already shows the preferred microphone missing", async () => {
    // Background enumeration must prevent repeating the failed preference request on every tap.
    rememberMicrophone({ deviceId: "usb", label: "External microphone" });
    navigator.mediaDevices.enumerateDevices = vi
      .fn()
      .mockResolvedValue([{ kind: "audioinput", deviceId: "built-in", label: "Built-in" }]);
    await listVoiceMicrophones();
    await requestVoiceCaptureStream();
    expect(getUserMediaMock).toHaveBeenCalledExactlyOnceWith({
      audio: expect.objectContaining({ deviceId: { exact: "default" } }),
    });
  });

  it("does not retry a denied or unreadable preferred microphone", async () => {
    rememberMicrophone({ deviceId: "usb", label: "External microphone" });
    for (const name of ["NotAllowedError", "NotReadableError"]) {
      // Denial and hardware errors are not evidence of a missing device.
      getUserMediaMock.mockReset().mockRejectedValue(new DOMException("Cannot open mic", name));
      await expect(requestVoiceCaptureStream()).rejects.toMatchObject({ name });
      expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps Safari's single-request path when the preferred device is missing", async () => {
    // Once Safari has rejected the Chrome-only default ID, an absent preferred device must
    // not reintroduce repeated requests after every idle permission grant expires.
    getUserMediaMock.mockRejectedValueOnce(new DOMException("No default device", "OverconstrainedError"));
    await requestVoiceCaptureStream();
    rememberMicrophone({ deviceId: "usb", label: "External microphone" });
    navigator.mediaDevices.enumerateDevices = vi
      .fn()
      .mockResolvedValue([{ kind: "audioinput", deviceId: "phone", label: "Phone microphone" }]);
    await listVoiceMicrophones();
    getUserMediaMock.mockClear();
    const request = requestVoiceCaptureStream();
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    expect(getUserMediaMock.mock.calls[0][0].audio).not.toHaveProperty("deviceId");
    await request;
  });

  it("falls back to the browser's own choice when it has no system-default device", async () => {
    // Safari and Firefox have no "default" deviceId and reject the exact constraint; they
    // already follow the system input, so the plain request is the right fallback.
    const fallbackStream = makeMockStream();
    getUserMediaMock
      .mockRejectedValueOnce(Object.assign(new Error("no default device"), { name: "OverconstrainedError" }))
      .mockResolvedValueOnce(fallbackStream);

    await expect(requestVoiceCaptureStream()).resolves.toBe(fallbackStream);
    expect(getUserMediaMock).toHaveBeenNthCalledWith(1, {
      audio: expect.objectContaining({ deviceId: { exact: "default" } }),
    });
    expect(getUserMediaMock.mock.calls[1][0].audio).not.toHaveProperty("deviceId");
  });

  it("makes a single plain request once the browser has shown it has no default device", async () => {
    // WebKit counts only the first microphone request of a tap as user-initiated. A request
    // without that re-prompts on iPhone after a minute of idle microphone and, after any
    // denial, fails without a prompt until reload. Later recordings in Safari must therefore
    // skip the doomed "default" attempt.
    getUserMediaMock.mockRejectedValueOnce(
      Object.assign(new Error("no default device"), { name: "OverconstrainedError" }),
    );
    await requestVoiceCaptureStream();
    getUserMediaMock.mockClear();

    await requestVoiceCaptureStream();
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    expect(getUserMediaMock.mock.calls[0][0].audio).not.toHaveProperty("deviceId");
  });

  it("does not retry when the user denies microphone access", async () => {
    getUserMediaMock.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));

    await expect(requestVoiceCaptureStream()).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
  });
});

// ── Hook tests: warmMicrophone ─────────────────────────────────────────────

describe("useVoiceInput — warmMicrophone", () => {
  it("discards a warmed stream after the preference changes", async () => {
    const oldStream = makeMockStream("live", "Built-in");
    const preferredStream = makeMockStream("live", "External microphone");
    getUserMediaMock.mockResolvedValueOnce(oldStream).mockResolvedValueOnce(preferredStream);
    const { result } = renderHook(() => useVoiceInput());
    await act(async () => result.current.warmMicrophone());
    rememberMicrophone({ deviceId: "usb", label: "External microphone" });
    await act(async () => result.current.startRecording());
    // Preference changes must take effect even inside the five-second pre-warm window.
    expect(oldStream.getTracks()[0].stop).toHaveBeenCalled();
    expect(result.current.inputDeviceLabel).toBe("External microphone");
    expect(getUserMediaMock).toHaveBeenLastCalledWith({
      audio: expect.objectContaining({ deviceId: { exact: "usb" } }),
    });
  });

  it("does not await a pre-warm for an old preference before the new recording request", async () => {
    let finishWarm!: (stream: MediaStream) => void;
    getUserMediaMock.mockImplementationOnce(
      () =>
        new Promise<MediaStream>((resolve) => {
          finishWarm = resolve;
        }),
    );
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.warmMicrophone());
    rememberMicrophone({ deviceId: "usb", label: "External microphone" });
    act(() => {
      result.current.startRecording();
    });
    // A changed preference must issue its capture while the new click still owns gesture privilege.
    expect(getUserMediaMock).toHaveBeenCalledTimes(2);
    const oldStream = makeMockStream();
    await act(async () => finishWarm(oldStream));
    expect(oldStream.getTracks()[0].stop).toHaveBeenCalled();
  });

  it("releases a preferred microphone whose pre-warm completes after unmount", async () => {
    // A device-selection change can leave the old hardware request in flight; it must not leak a mic.
    let finishWarm!: (stream: MediaStream) => void;
    getUserMediaMock.mockImplementationOnce(
      () =>
        new Promise<MediaStream>((resolve) => {
          finishWarm = resolve;
        }),
    );
    rememberMicrophone({ deviceId: "usb", label: "External microphone" });
    const { result, unmount } = renderHook(() => useVoiceInput());
    act(() => result.current.warmMicrophone());
    unmount();
    const stream = makeMockStream();
    await act(async () => finishWarm(stream));
    expect(stream.getTracks()[0].stop).toHaveBeenCalled();
  });

  it("discards a warmed fallback after the preferred microphone reconnects", async () => {
    const fallback = makeMockStream("live", "Built-in");
    const usb = makeMockStream("live", "External microphone");
    const enumerateDevices = vi
      .fn()
      .mockResolvedValue([{ kind: "audioinput", deviceId: "built-in", label: "Built-in" }]);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: Object.assign(new EventTarget(), { enumerateDevices, getUserMedia: getUserMediaMock }),
    });
    rememberMicrophone({ deviceId: "usb", label: "External microphone" });
    getUserMediaMock.mockResolvedValueOnce(fallback).mockResolvedValueOnce(usb);
    const { result } = renderHook(() => useVoiceInput());
    await act(async () => {});
    await act(async () => result.current.warmMicrophone());
    enumerateDevices.mockResolvedValue([{ kind: "audioinput", deviceId: "usb", label: "External microphone" }]);
    await act(async () => navigator.mediaDevices.dispatchEvent(new Event("devicechange")));
    await act(async () => result.current.startRecording());
    // Availability changes invalidate the warm stream just like a changed preference does.
    expect(fallback.getTracks()[0].stop).toHaveBeenCalled();
    expect(result.current.inputDeviceLabel).toBe("External microphone");
  });

  it("calls getUserMedia once on first warmMicrophone call", async () => {
    const { result } = renderHook(() => useVoiceInput());

    act(() => {
      result.current.warmMicrophone();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    expect(getUserMediaMock).toHaveBeenCalledWith({
      audio: {
        // Chrome's "default" device follows the system input instead of Chrome's own mic ranking.
        deviceId: { exact: "default" },
        channelCount: { ideal: 1 },
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
      },
    });
  });

  it("no-ops on repeated warmMicrophone calls when stream is already cached and live", async () => {
    const { result } = renderHook(() => useVoiceInput());

    // First call caches the stream
    act(() => {
      result.current.warmMicrophone();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);

    // Second call should be a no-op (cached stream tracks are "live")
    act(() => {
      result.current.warmMicrophone();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
  });

  it("silently swallows getUserMedia rejection without setting error", async () => {
    getUserMediaMock.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    const { result } = renderHook(() => useVoiceInput());

    act(() => {
      result.current.warmMicrophone();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // warmMicrophone should NOT set error -- it's a background pre-warm
    expect(result.current.error).toBeNull();
  });

  it("no-ops when voice input is not supported", () => {
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: false,
    });

    const { result } = renderHook(() => useVoiceInput());

    act(() => {
      result.current.warmMicrophone();
    });
    expect(getUserMediaMock).not.toHaveBeenCalled();
  });

  it("startRecording reuses pre-warmed stream and skips getUserMedia", async () => {
    const { result } = renderHook(() => useVoiceInput());

    // Pre-warm
    act(() => {
      result.current.warmMicrophone();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);

    // Start recording -- should reuse cached stream
    await act(async () => {
      result.current.startRecording();
    });
    expect(result.current.isRecording).toBe(true);
    expect(result.current.isPreparing).toBe(false);
    // No additional getUserMedia call
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
  });

  it("releases cached stream after idle timeout (5s)", async () => {
    const mockStream = makeMockStream();
    getUserMediaMock.mockResolvedValue(mockStream);

    const { result } = renderHook(() => useVoiceInput());

    act(() => {
      result.current.warmMicrophone();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);

    // Advance past the 5s idle timeout
    act(() => {
      vi.advanceTimersByTime(6_000);
    });

    // Stream tracks should have been stopped
    expect(mockStream.getTracks()[0].stop).toHaveBeenCalled();

    // Next warmMicrophone should request a fresh stream
    act(() => {
      result.current.warmMicrophone();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getUserMediaMock).toHaveBeenCalledTimes(2);
  });
});

// ── Hook tests: stale stream fallback ──────────────────────────────────────

describe("useVoiceInput — stale stream fallback", () => {
  it("falls back to fresh getUserMedia when cached stream tracks have ended", async () => {
    // First warm returns a stream whose tracks will be "ended"
    const staleStream = makeMockStream("ended");
    const freshStream = makeMockStream("live");
    getUserMediaMock
      .mockResolvedValueOnce(staleStream) // for warmMicrophone
      .mockResolvedValueOnce(freshStream); // for startRecording fallback

    const { result } = renderHook(() => useVoiceInput());

    // Pre-warm with what will become a stale stream
    act(() => {
      result.current.warmMicrophone();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);

    // Start recording -- stale stream should be detected, fresh getUserMedia triggered
    await act(async () => {
      result.current.startRecording();
    });
    expect(getUserMediaMock).toHaveBeenCalledTimes(2);
    expect(result.current.isRecording).toBe(true);
    expect(result.current.isPreparing).toBe(false);
  });

  it("warmMicrophone re-requests stream when cached tracks have ended", async () => {
    // First warm: live stream that we'll mark as ended
    const stream = makeMockStream("live");
    getUserMediaMock.mockResolvedValue(stream);

    const { result } = renderHook(() => useVoiceInput());

    // Warm and cache
    act(() => {
      result.current.warmMicrophone();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);

    // Simulate permission revocation by marking track as ended
    (stream.getTracks()[0] as { readyState: string }).readyState = "ended";

    // Next warmMicrophone should detect stale tracks and request fresh stream
    act(() => {
      result.current.warmMicrophone();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getUserMediaMock).toHaveBeenCalledTimes(2);
  });
});

// ── Hook tests: onAudioReady callback ──────────────────────────────────────

describe("useVoiceInput — onAudioReady", () => {
  it("fires onAudioReady with recorded blob when recording stops normally", async () => {
    const onAudioReady = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onAudioReady }));

    await act(async () => {
      result.current.startRecording();
    });
    expect(result.current.isRecording).toBe(true);

    await act(async () => {
      result.current.stopRecording();
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.isRecording).toBe(false);
    expect(onAudioReady).toHaveBeenCalledTimes(1);
    expect(onAudioReady.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(onAudioReady.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        chunkCount: 2,
        chunkBytes: 9,
        blobBytes: 9,
        timesliceMs: 1000,
        selectedMimeType: "audio/mp4;codecs=mp4a.40.2",
        recorderMimeType: "audio/mp4;codecs=mp4a.40.2",
        blobMimeType: "audio/mp4;codecs=mp4a.40.2",
        audioBitsPerSecond: 48_000,
        stopReason: "manual",
        recorderStateAtStart: "inactive",
        recorderStateAfterStart: "recording",
        recorderStateAtStopRequest: "recording",
        recorderStateAtStopEvent: "inactive",
        requestDataBeforeStop: true,
        audioTrackStatesAtStart: "live",
        audioTrackStatesAtStop: "live",
        audioTrackMutedAtStart: false,
        audioTrackMutedAtStop: false,
        trackEndedEventCount: 0,
        trackMuteEventCount: 0,
        trackUnmuteEventCount: 0,
        stopToBlobReadyMs: expect.any(Number),
        blobBuildDurationMs: expect.any(Number),
      }),
    );
    expect(MockMediaRecorder.lastInstance?.startTimesliceMs).toBe(1000);
    expect(MockMediaRecorder.lastInstance?.requestData).toHaveBeenCalledTimes(1);
  });

  it("names the recorded microphone while recording and in the recording timing", async () => {
    // Chrome labels its system-default device "Default - <name>". The UI shows the bare
    // device name, while debug timing keeps the raw label as evidence it followed the default.
    getUserMediaMock.mockResolvedValue(makeMockStream("live", "Default - Otter Pods Pro 3 (Bluetooth)"));
    const onAudioReady = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onAudioReady }));
    expect(result.current.inputDeviceLabel).toBeNull();

    await act(async () => {
      result.current.startRecording();
    });
    expect(result.current.inputDeviceLabel).toBe("Otter Pods Pro 3 (Bluetooth)");

    await act(async () => {
      result.current.stopRecording();
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.inputDeviceLabel).toBeNull();
    expect(onAudioReady.mock.calls[0][1]).toEqual(
      expect.objectContaining({ audioInputLabel: "Default - Otter Pods Pro 3 (Bluetooth)" }),
    );
  });

  it("omits the microphone name when the browser hides track labels", async () => {
    const onAudioReady = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onAudioReady }));

    await act(async () => {
      result.current.startRecording();
    });
    expect(result.current.inputDeviceLabel).toBeNull();

    await act(async () => {
      result.current.stopRecording();
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(onAudioReady.mock.calls[0][1]).not.toHaveProperty("audioInputLabel");
  });

  it("accumulates periodic, requested, and final non-empty chunks into one blob", async () => {
    const onAudioReady = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onAudioReady }));

    await act(async () => {
      result.current.startRecording();
    });
    const recorder = MockMediaRecorder.lastInstance!;
    act(() => {
      recorder.emitData("first");
      recorder.ondataavailable?.({ data: new Blob([], { type: "audio/webm" }) });
      recorder.emitData("second");
    });

    await act(async () => {
      result.current.stopRecording();
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(onAudioReady).toHaveBeenCalledTimes(1);
    const blob = onAudioReady.mock.calls[0][0] as Blob;
    await expect(blob.text()).resolves.toBe("firstsecondflushtail");
    expect(onAudioReady.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        chunkCount: 4,
        chunkBytes: 20,
        blobBytes: 20,
      }),
    );
  });

  it("still stops and reports diagnostics when requestData throws", async () => {
    const onAudioReady = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onAudioReady }));

    await act(async () => {
      result.current.startRecording();
    });
    const recorder = MockMediaRecorder.lastInstance!;
    recorder.requestDataThrows = true;

    await act(async () => {
      result.current.stopRecording();
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(onAudioReady).toHaveBeenCalledTimes(1);
    expect(onAudioReady.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        chunkCount: 1,
        chunkBytes: 4,
        blobBytes: 4,
        requestDataError: "requestData failed",
        stopReason: "manual",
      }),
    );
  });

  it("does NOT fire onAudioReady when recording is cancelled", async () => {
    const onAudioReady = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onAudioReady }));

    await act(async () => {
      result.current.startRecording();
    });
    await act(async () => {
      result.current.cancelRecording();
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(result.current.isRecording).toBe(false);
    expect(onAudioReady).not.toHaveBeenCalled();
  });
});

describe("useVoiceInput — volume history", () => {
  function mockAnimationFrames() {
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    return {
      runNextFrame: (timestamp: number) => {
        const callback = callbacks.shift();
        if (!callback) throw new Error("No queued animation frame");
        callback(timestamp);
      },
    };
  }

  it("samples the live meter into a bounded rolling history without storing every frame", async () => {
    const frames = mockAnimationFrames();
    MockAudioContext.sampleAmplitude = 32;
    const { result } = renderHook(() => useVoiceInput());

    await act(async () => {
      result.current.startRecording();
    });

    act(() => frames.runNextFrame(0));
    expect(result.current.volumeHistory).toHaveLength(1);

    act(() => frames.runNextFrame(VOICE_LEVEL_HISTORY_SAMPLE_INTERVAL_MS - 1));
    expect(result.current.volumeHistory).toHaveLength(1);

    act(() => frames.runNextFrame(VOICE_LEVEL_HISTORY_SAMPLE_INTERVAL_MS));
    expect(result.current.volumeHistory).toHaveLength(2);
    expect(result.current.volumeHistory[1].level).toBeGreaterThan(0);
  });

  it("clears rolling history when recording stops normally", async () => {
    const frames = mockAnimationFrames();
    MockAudioContext.sampleAmplitude = 32;
    const { result } = renderHook(() => useVoiceInput());

    await act(async () => {
      result.current.startRecording();
    });
    act(() => frames.runNextFrame(0));
    expect(result.current.volumeHistory).toHaveLength(1);

    act(() => {
      result.current.stopRecording();
    });
    expect(result.current.volumeHistory).toEqual([]);
  });

  it("clears rolling history when recording is cancelled", async () => {
    const frames = mockAnimationFrames();
    MockAudioContext.sampleAmplitude = 32;
    const { result } = renderHook(() => useVoiceInput());

    await act(async () => {
      result.current.startRecording();
    });
    act(() => frames.runNextFrame(0));
    expect(result.current.volumeHistory).toHaveLength(1);

    act(() => {
      result.current.cancelRecording();
    });
    expect(result.current.volumeHistory).toEqual([]);
  });
});

// ── Hook tests: recorder error handling ────────────────────────────────────

describe("useVoiceInput — recorder.onerror", () => {
  it("sets error and clears recording state when MediaRecorder errors mid-recording", async () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    MockAudioContext.sampleAmplitude = 32;
    const onAudioReady = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onAudioReady }));

    await act(async () => {
      result.current.startRecording();
    });
    act(() => callbacks.shift()?.(0));
    expect(result.current.volumeHistory).toHaveLength(1);
    expect(result.current.isRecording).toBe(true);

    // Simulate a recorder error via the mock's triggerError helper
    const recorder = MockMediaRecorder.lastInstance!;
    act(() => {
      recorder.triggerError();
    });

    expect(result.current.isRecording).toBe(false);
    expect(result.current.isPreparing).toBe(false);
    expect(result.current.volumeHistory).toEqual([]);
    expect(result.current.error).toBe("Recording failed");
    expect(onAudioReady).not.toHaveBeenCalled();
  });
});

// ── Hook tests: warming promise race prevention ────────────────────────────

describe("useVoiceInput — warming promise coalescing", () => {
  it("startRecording awaits in-flight warmMicrophone instead of duplicating getUserMedia", async () => {
    // Make getUserMedia hang until we resolve it manually
    let resolveStream!: (stream: MediaStream) => void;
    getUserMediaMock.mockImplementation(
      () =>
        new Promise<MediaStream>((r) => {
          resolveStream = r;
        }),
    );

    const { result } = renderHook(() => useVoiceInput());

    // Start warming (fires getUserMedia, hangs on promise)
    act(() => {
      result.current.warmMicrophone();
    });

    // Immediately start recording before warm resolves -- should NOT fire a second getUserMedia
    act(() => {
      result.current.startRecording();
    });
    expect(result.current.isPreparing).toBe(true);

    // Resolve the single getUserMedia call
    await act(async () => {
      resolveStream(makeMockStream());
    });

    expect(result.current.isRecording).toBe(true);
    expect(result.current.isPreparing).toBe(false);
    // Only ONE getUserMedia call total (not two)
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
  });

  it("concurrent warmMicrophone calls do not fire duplicate getUserMedia requests", async () => {
    const { result } = renderHook(() => useVoiceInput());

    // Fire warmMicrophone twice in quick succession
    act(() => {
      result.current.warmMicrophone();
      result.current.warmMicrophone();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Only one getUserMedia call despite two warmMicrophone calls
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
  });
});

// ── Hook tests: screen wake lock ───────────────────────────────────────────

describe("useVoiceInput — screen wake lock", () => {
  // On iPhone, the screen auto-locking during a long dictation ends microphone capture, so the
  // hook keeps the screen on from the tap that starts recording until recording ends.
  let releaseLock: ReturnType<typeof vi.fn>;
  let requestLock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    releaseLock = vi.fn(async () => {});
    requestLock = vi.fn(async () => ({ released: false, release: releaseLock }));
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: requestLock } });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "wakeLock");
  });

  it("asks for the lock inside the tap, after the microphone, and releases it when recording stops", async () => {
    // WebKit grants the first wake lock only during the tap, and only the tap's first
    // microphone request counts as user-initiated, so both happen before any await, mic first.
    const order: string[] = [];
    getUserMediaMock.mockImplementation(async () => {
      order.push("microphone");
      return makeMockStream();
    });
    requestLock.mockImplementation(async () => {
      order.push("wake-lock");
      return { released: false, release: releaseLock };
    });
    const { result } = renderHook(() => useVoiceInput());

    act(() => {
      result.current.startRecording();
    });
    expect(order).toEqual(["microphone", "wake-lock"]);

    await act(async () => {});
    expect(result.current.isRecording).toBe(true);
    expect(releaseLock).not.toHaveBeenCalled();

    await act(async () => {
      result.current.stopRecording();
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it("releases the lock when the browser stops the recording by itself", async () => {
    // iPhone ends capture when the screen locks anyway; the recorder then stops on its own.
    const { result } = renderHook(() => useVoiceInput());
    await act(async () => {
      result.current.startRecording();
    });

    await act(async () => {
      MockMediaRecorder.lastInstance!.stop();
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it("releases the lock when microphone access fails", async () => {
    getUserMediaMock.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    const { result } = renderHook(() => useVoiceInput());

    await act(async () => {
      result.current.startRecording();
    });
    expect(requestLock).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it("releases the lock when the recorder errors or the input unmounts", async () => {
    const first = renderHook(() => useVoiceInput());
    await act(async () => {
      first.result.current.startRecording();
    });
    act(() => MockMediaRecorder.lastInstance!.triggerError());
    expect(releaseLock).toHaveBeenCalledTimes(1);

    const second = renderHook(() => useVoiceInput());
    await act(async () => {
      second.result.current.startRecording();
    });
    second.unmount();
    expect(releaseLock).toHaveBeenCalledTimes(2);
  });

  it("keeps a single lock for a pre-warmed recording", async () => {
    const { result } = renderHook(() => useVoiceInput());
    await act(async () => {
      result.current.warmMicrophone();
    });
    await act(async () => {
      result.current.startRecording();
    });
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    expect(requestLock).toHaveBeenCalledTimes(1);
  });
});

// Live switches must keep the original recorder and audio chunks, including failure/cancellation races.
describe("useVoiceInput — live microphone selection", () => {
  it("switches the input without replacing the recorder or losing earlier chunks", async () => {
    const first = makeMockStream("live", "Built-in microphone");
    const second = makeMockStream("live", "External microphone");
    getUserMediaMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const onAudioReady = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onAudioReady }));
    await act(async () => {
      result.current.startRecording();
    });
    const recorder = MockMediaRecorder.lastInstance!;
    recorder.emitData("before-switch");
    let selection!: Promise<"switched" | "next-recording">;
    act(() => {
      selection = result.current.microphoneSelection.select({ deviceId: "usb", label: "External microphone" });
    });
    expect(getUserMediaMock).toHaveBeenLastCalledWith({
      audio: expect.objectContaining({ deviceId: { exact: "usb" } }),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
      expect(await selection).toBe("switched");
    });
    expect(MockMediaRecorder.lastInstance).toBe(recorder);
    expect(recorder.state).toBe("recording");
    expect(first.getTracks()[0].stop).toHaveBeenCalledOnce();
    expect(second.getTracks()[0].stop).not.toHaveBeenCalled();
    expect(result.current.inputDeviceLabel).toBe("External microphone");
    recorder.emitData("after-switch");
    await act(async () => {
      result.current.stopRecording();
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(onAudioReady).toHaveBeenCalledOnce();
    const blob = onAudioReady.mock.calls[0][0] as Blob;
    expect(blob.size).toBeGreaterThanOrEqual("before-switchafter-switch".length);
    expect(onAudioReady.mock.calls[0][1].audioInputLabel).toBe("Built-in microphone → External microphone");
    expect(second.getTracks()[0].stop).toHaveBeenCalledOnce();
  });

  it("keeps recording on the old mic when opening the selected one is denied", async () => {
    const first = makeMockStream("live", "Built-in microphone");
    getUserMediaMock.mockResolvedValueOnce(first).mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
    const { result } = renderHook(() => useVoiceInput());
    await act(async () => {
      result.current.startRecording();
    });
    await expect(
      result.current.microphoneSelection.select({ deviceId: "usb", label: "External microphone" }),
    ).rejects.toThrow("Still recording");
    expect(first.getTracks()[0].stop).not.toHaveBeenCalled();
    expect(MockMediaRecorder.lastInstance!.state).toBe("recording");
    expect(result.current.inputDeviceLabel).toBe("Built-in microphone");
  });

  it("releases a late replacement after recording was cancelled", async () => {
    let finish!: (stream: MediaStream) => void;
    const { result } = renderHook(() => useVoiceInput());
    await act(async () => {
      result.current.startRecording();
    });
    getUserMediaMock.mockImplementationOnce(
      () =>
        new Promise<MediaStream>((resolve) => {
          finish = resolve;
        }),
    );
    const selection = result.current.microphoneSelection.select({ deviceId: "usb", label: "External microphone" });
    act(() => result.current.cancelRecording());
    const late = makeMockStream();
    await act(async () => {
      finish(late);
      await selection;
    });
    expect(late.getTracks()[0].stop).toHaveBeenCalledOnce();
    expect(result.current.isRecording).toBe(false);
  });

  it("saves a pick for next time when the browser cannot create a stable recording input", async () => {
    vi.spyOn(MockAudioContext.prototype, "createMediaStreamDestination").mockImplementation(() => {
      throw new Error("Unsupported");
    });
    const current = makeMockStream("live", "Built-in microphone");
    getUserMediaMock.mockResolvedValueOnce(current);
    const { result } = renderHook(() => useVoiceInput());
    await act(async () => {
      result.current.startRecording();
    });
    expect(await result.current.microphoneSelection.select({ deviceId: "usb", label: "External microphone" })).toBe(
      "next-recording",
    );
    expect(getUserMediaMock).toHaveBeenCalledOnce();
    expect(current.getTracks()[0].stop).not.toHaveBeenCalled();
    expect(result.current.isRecording).toBe(true);
  });

  it("finishes captured audio when the hardware source ends instead of recording a silent bridge forever", async () => {
    const input = makeMockStream();
    getUserMediaMock.mockResolvedValueOnce(input);
    const onAudioReady = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onAudioReady }));
    await act(async () => {
      result.current.startRecording();
    });
    await act(async () => {
      (input.getAudioTracks()[0] as unknown as { emit: (type: string) => void }).emit("ended");
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.isRecording).toBe(false);
    expect(onAudioReady).toHaveBeenCalledOnce();
  });

  it("tries a lower-ranked remembered mic before the system when the first saved ID has vanished", async () => {
    rememberMicrophone({ deviceId: "built-in", label: "Built-in" });
    rememberMicrophone({ deviceId: "usb", label: "External" });
    getUserMediaMock.mockRejectedValueOnce(new DOMException("Gone", "OverconstrainedError"));
    await requestVoiceCaptureStream();
    expect(getUserMediaMock).toHaveBeenNthCalledWith(2, {
      audio: expect.objectContaining({ deviceId: { exact: "built-in" } }),
    });
  });
});

it("releases a replacement cancelled while its audio source is priming", async () => {
  // Cancellation can happen after getUserMedia resolves but before the 60ms graph handoff.
  const next = makeMockStream("live", "External microphone");
  const { result } = renderHook(() => useVoiceInput());
  await act(async () => {
    result.current.startRecording();
  });
  getUserMediaMock.mockResolvedValueOnce(next);
  let switching!: Promise<"switched" | "next-recording">;
  await act(async () => {
    switching = result.current.microphoneSelection.select({ deviceId: "usb", label: "External microphone" });
  });
  act(() => result.current.cancelRecording());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60);
    await switching;
  });
  expect(next.getTracks()[0].stop).toHaveBeenCalledOnce();
  expect(result.current.isRecording).toBe(false);
});

it("releases a microphone granted after preparing was cancelled", async () => {
  let grant!: (stream: MediaStream) => void;
  getUserMediaMock.mockImplementationOnce(
    () =>
      new Promise<MediaStream>((resolve) => {
        grant = resolve;
      }),
  );
  const { result } = renderHook(() => useVoiceInput());
  act(() => {
    result.current.startRecording();
  });
  act(() => result.current.cancelRecording());
  const stream = makeMockStream();
  await act(async () => {
    grant(stream);
  });
  expect(stream.getTracks()[0].stop).toHaveBeenCalledOnce();
  expect(result.current.isRecording).toBe(false);
  expect(MockMediaRecorder.lastInstance).toBeNull();
});

describe("useVoiceInput — WebKit records the microphone track directly", () => {
  // WebKit's Web Audio keeps the output rate it started with. With AirPods worn, opening a mic moves
  // the iPhone to the headset's call route, and recordings routed through Web Audio came out at about
  // a third of real time and near-silent, whichever mic was chosen. So WebKit records the mic track
  // and starts the level meter's audio context only after capture has opened.
  beforeEach(() => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: IPHONE_SAFARI_USER_AGENT });
  });

  it("records the mic track and meters it with an audio context started after capture opened", async () => {
    const order: string[] = [];
    vi.stubGlobal(
      "AudioContext",
      class extends MockAudioContext {
        constructor() {
          super();
          order.push("audio-context");
        }
      },
    );
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => frames.push(callback));
    MockAudioContext.sampleAmplitude = 32;
    const mic = makeMockStream("live", "AirPods Pro");
    let grant!: (stream: MediaStream) => void;
    getUserMediaMock.mockImplementationOnce(async () => {
      order.push("microphone");
      return new Promise<MediaStream>((resolve) => {
        grant = resolve;
      });
    });
    const { result } = renderHook(() => useVoiceInput());

    act(() => {
      result.current.startRecording();
    });
    expect(order).toEqual(["microphone"]);

    await act(async () => grant(mic));
    expect(order).toEqual(["microphone", "audio-context"]);
    expect(result.current.isRecording).toBe(true);
    expect(MockMediaRecorder.lastInstance?.stream).toBe(mic);

    act(() => frames.shift()?.(0));
    expect(result.current.volumeLevel).toBeGreaterThan(0);
  });

  it("saves a mid-recording mic pick for the next recording without opening it", async () => {
    // Opening the other mic would change the route under the running recording.
    const mic = makeMockStream("live", "AirPods Pro");
    getUserMediaMock.mockResolvedValueOnce(mic);
    const { result } = renderHook(() => useVoiceInput());
    await act(async () => {
      result.current.startRecording();
    });

    let selection!: "switched" | "next-recording";
    await act(async () => {
      selection = await result.current.microphoneSelection.select({ deviceId: "built-in", label: "iPhone Microphone" });
    });
    expect(selection).toBe("next-recording");
    expect(getUserMediaMock).toHaveBeenCalledOnce();
    expect(mic.getTracks()[0].stop).not.toHaveBeenCalled();
    expect(MockMediaRecorder.lastInstance?.state).toBe("recording");
  });
});
