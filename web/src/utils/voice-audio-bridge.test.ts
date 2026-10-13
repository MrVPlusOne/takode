import { afterEach, expect, it, vi } from "vitest";
import { createVoiceAudioBridge } from "./voice-audio-bridge.js";

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
