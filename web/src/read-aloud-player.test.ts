// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const input = { sessionId: "s1", messageId: "m1", text: "Hello there.", historyIndex: 4 };

/** A fetch whose responses the test releases, to observe the "preparing" state in between. */
function deferredFetch() {
  const responders: Array<(res: Response) => void> = [];
  const fetchMock = vi.fn(
    (_url: string, _init: RequestInit) => new Promise<Response>((resolve) => responders.push(resolve)),
  );
  vi.stubGlobal("fetch", fetchMock);
  const respond = (res: Response) => act(async () => responders.shift()!(res));
  return { fetchMock, respond };
}

const mp3 = () => new Response(new Blob(["mp3"]), { headers: { "Content-Type": "audio/mpeg" } });

let srcAtPlay: string[];
let player: typeof import("./read-aloud-player.js");

beforeEach(async () => {
  // Fresh module per test: the player keeps one audio element and the loaded preferences.
  vi.resetModules();
  localStorage.clear();
  srcAtPlay = [];
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    srcAtPlay.push(this.src);
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  let blobCount = 0;
  URL.createObjectURL = vi.fn(() => `blob:reply-audio-${++blobCount}`);
  URL.revokeObjectURL = vi.fn();
  player = await import("./read-aloud-player.js");
});

afterEach(() => {
  act(() => player.stopReadAloud());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function lastAudio(): HTMLAudioElement {
  const calls = vi.mocked(HTMLMediaElement.prototype.play).mock.contexts;
  return calls.at(-1) as HTMLAudioElement;
}

describe("read-aloud player", () => {
  it("unlocks audio in the tap, then plays the reply's audio in the saved voice", async () => {
    const { fetchMock, respond } = deferredFetch();
    const { result } = renderHook(() => player.useReadAloudState("m1"));

    act(() => player.startReadAloud(input));

    // iOS only allows audio started inside the tap, so a silent clip plays right away.
    expect(srcAtPlay).toHaveLength(1);
    expect(srcAtPlay[0]).toMatch(/^data:audio\/wav;base64,/);
    expect(result.current?.status).toBe("preparing");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sessions/s1/read-aloud");
    expect(JSON.parse(String(init.body))).toEqual({
      messageId: "m1",
      text: "Hello there.",
      historyIndex: 4,
      voice: "marin",
    });

    await respond(mp3());

    expect(srcAtPlay[1]).toBe("blob:reply-audio-1");
    expect(result.current?.status).toBe("ready");
  });

  it("stop cancels a reply still being prepared", async () => {
    const { fetchMock, respond } = deferredFetch();
    const { result } = renderHook(() => player.useReadAloudState("m1"));

    act(() => player.startReadAloud(input));
    act(() => player.stopReadAloud());

    expect((fetchMock.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
    expect(result.current).toBeNull();
    await respond(mp3());
    expect(srcAtPlay).toHaveLength(1);
    expect(result.current).toBeNull();
  });

  it("shows the server's error on the message", async () => {
    const { respond } = deferredFetch();
    const { result } = renderHook(() => player.useReadAloudState("m1"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    act(() => player.startReadAloud(input));
    await respond(Response.json({ error: "Read aloud failed. quota" }, { status: 502 }));

    expect(result.current).toEqual({
      messageId: "m1",
      sessionId: "s1",
      status: "error",
      error: "Read aloud failed. quota",
    });
  });

  it("keeps the player open at the end so the reply can be played again", async () => {
    const { respond } = deferredFetch();
    const { result } = renderHook(() => player.useCurrentReadAloud());
    act(() => player.startReadAloud(input));
    await respond(mp3());

    act(() => {
      lastAudio().dispatchEvent(new Event("ended"));
    });
    expect(result.current?.status).toBe("ready");

    act(() => player.stopReadAloud());
    expect(result.current).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:reply-audio-1");
  });

  it("seeks, skips 5 seconds within the audio, and applies the speed", async () => {
    const { respond } = deferredFetch();
    act(() => player.startReadAloud(input));
    await respond(mp3());
    const audio = lastAudio();
    Object.defineProperty(audio, "duration", { configurable: true, value: 60 });

    act(() => player.seekReadAloud(30));
    expect(audio.currentTime).toBe(30);
    act(() => player.skipReadAloud(1));
    expect(audio.currentTime).toBe(35);
    act(() => player.skipReadAloud(-1));
    act(() => player.skipReadAloud(-1));
    expect(audio.currentTime).toBe(25);
    act(() => player.seekReadAloud(90));
    expect(audio.currentTime).toBe(60);

    act(() => player.setReadAloudPlaybackRate(1.5));
    expect(audio.playbackRate).toBe(1.5);
  });

  it("remembers voice and speed for the next visit", async () => {
    act(() => {
      player.setReadAloudVoice("ash");
      player.setReadAloudPlaybackRate(1.25);
    });
    vi.resetModules();
    const reloaded = await import("./read-aloud-player.js");
    const { result } = renderHook(() => reloaded.useReadAloudPreferences());
    expect(result.current).toEqual({ voice: "ash", playbackRate: 1.25 });
  });

  it("changing the voice reads the same message again from the same point", async () => {
    const { fetchMock, respond } = deferredFetch();
    act(() => player.startReadAloud(input));
    await respond(mp3());
    const audio = lastAudio();
    Object.defineProperty(audio, "duration", { configurable: true, value: 40 });
    audio.currentTime = 10;

    act(() => player.setReadAloudVoice("cedar"));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).voice).toBe("cedar");
    await respond(mp3());
    audio.currentTime = 0;
    // The new audio resumes a quarter of the way in, once its length is known.
    await act(async () => {
      audio.dispatchEvent(new Event("loadedmetadata"));
    });
    expect(audio.currentTime).toBe(10);
    expect(srcAtPlay.at(-1)).toBe("blob:reply-audio-2");
  });

  it("changing the voice after the end reads the message again from the start", async () => {
    const { respond } = deferredFetch();
    act(() => player.startReadAloud(input));
    await respond(mp3());
    const audio = lastAudio();
    Object.defineProperty(audio, "duration", { configurable: true, value: 40 });
    Object.defineProperty(audio, "ended", { configurable: true, value: true });
    audio.currentTime = 40;

    act(() => player.setReadAloudVoice("coral"));
    await respond(mp3());
    // No resume point to wait for: the new audio plays right away, from the start.
    expect(srcAtPlay.at(-1)).toBe("blob:reply-audio-2");
  });

  it("reading another message replaces the current one", async () => {
    const { respond } = deferredFetch();
    const first = renderHook(() => player.useReadAloudState("m1"));
    const second = renderHook(() => player.useReadAloudState("m2"));

    act(() => player.startReadAloud(input));
    await respond(mp3());
    act(() => player.startReadAloud({ ...input, messageId: "m2" }));

    expect(first.result.current).toBeNull();
    expect(second.result.current?.status).toBe("preparing");
  });
});
