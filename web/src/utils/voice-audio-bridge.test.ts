import { afterEach, expect, it, vi } from "vitest";
import { canRecordThroughVoiceAudioBridge, createVoiceAudioBridge } from "./voice-audio-bridge.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function stubContext(state = "running") {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] };
  const sources: Array<{ connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  const context = {
    state,
    resume: vi.fn(async () => {
      context.state = "running";
    }),
    close: vi.fn(async () => {
      context.state = "closed";
    }),
    createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() })),
    createAnalyser: vi.fn(() => ({ fftSize: 0, smoothingTimeConstant: 0 })),
    createMediaStreamDestination: vi.fn(() => ({ stream, channelCount: 2 })),
    createMediaStreamSource: vi.fn(() => {
      const source = { connect: vi.fn(), disconnect: vi.fn() };
      sources.push(source);
      return source;
    }),
  };
  vi.stubGlobal("AudioContext", function () {
    return context;
  });
  return { context, stream, sources, stop };
}

it("keeps one recorder track while swapping upstream sources and closes everything once", async () => {
  const { sources, stream, stop, context } = stubContext();
  const bridge = createVoiceAudioBridge()!;
  expect(await bridge.ready).toBe(true);
  const first = {} as MediaStream;
  const second = {} as MediaStream;
  await bridge.setInput(first);
  const switching = bridge.setInput(second);
  expect(sources[0].disconnect).not.toHaveBeenCalled();
  await switching;
  // MediaRecorder sees the same stream and track: no invalid track-set mutation or concatenated files.
  expect(bridge.stream).toBe(stream);
  expect(sources[0].disconnect).toHaveBeenCalledOnce();
  expect(sources[1].connect).toHaveBeenCalledOnce();
  expect(sources[1].disconnect).not.toHaveBeenCalled();
  bridge.close();
  bridge.close();
  expect(sources[1].disconnect).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
  expect(context.close).toHaveBeenCalledOnce();
});

it("resumes in the caller's gesture and reports a blocked context without hanging capture", async () => {
  vi.useFakeTimers();
  const { context } = stubContext("suspended");
  context.resume.mockImplementation(() => new Promise(() => {}));
  const bridge = createVoiceAudioBridge()!;
  expect(context.resume).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(500);
  expect(await bridge.ready).toBe(false);
  bridge.close();
});

it("keeps the current source connected when switching becomes unavailable", async () => {
  const { context, sources } = stubContext();
  const bridge = createVoiceAudioBridge()!;
  await bridge.ready;
  await bridge.setInput({} as MediaStream);
  context.state = "suspended";
  await expect(bridge.setInput({} as MediaStream)).rejects.toThrow("unavailable");
  expect(sources[0].disconnect).not.toHaveBeenCalled();
  bridge.close();
});

it("cleans up partial setup and allows direct recording when the bridge API is absent", () => {
  const { context } = stubContext();
  context.createMediaStreamDestination.mockImplementation(() => {
    throw new Error("Unsupported");
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(createVoiceAudioBridge()).toBeNull();
  expect(context.close).toHaveBeenCalledOnce();
});

it("keeps recordings off the bridge in WebKit, whose Web Audio breaks when a headset mic changes the audio route", () => {
  const ua = {
    iPhoneSafari:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
    // Every iPhone browser runs on WebKit; Chrome there says "CriOS", not "Chrome/".
    iPhoneChrome:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
    macSafari:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15",
    macChrome:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    firefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
  };
  expect(canRecordThroughVoiceAudioBridge(ua.iPhoneSafari)).toBe(false);
  expect(canRecordThroughVoiceAudioBridge(ua.iPhoneChrome)).toBe(false);
  expect(canRecordThroughVoiceAudioBridge(ua.macSafari)).toBe(false);
  expect(canRecordThroughVoiceAudioBridge(ua.macChrome)).toBe(true);
  expect(canRecordThroughVoiceAudioBridge(ua.edge)).toBe(true);
  expect(canRecordThroughVoiceAudioBridge(ua.firefox)).toBe(true);
});
