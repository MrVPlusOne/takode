// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { READ_ALOUD_STREAM_CONTENT_TYPE, encodeReadAloudFrame } from "../shared/read-aloud-stream.js";

const input = { sessionId: "s1", messageId: "m1", text: "Hello there.", historyIndex: 4 };

/** A fetch whose responses the test releases, to observe the "preparing" state in between. */
function deferredFetch() {
  const responders: Array<(res: Response) => void> = [];
  const fetchMock = vi.fn(
    (_url: string, _init: RequestInit) => new Promise<Response>((resolve) => responders.push(resolve)),
  );
  vi.stubGlobal("fetch", fetchMock);
  // The body is read after the response resolves, so let it arrive before the test looks.
  const respond = (res: Response) =>
    act(async () => {
      responders.shift()!(res);
      for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    });
  return { fetchMock, respond };
}

/** A streamed read (shared/read-aloud-stream.ts): pieces of the given lengths, then done. */
const mp3 = (...seconds: number[]) => {
  const pieces = (seconds.length ? seconds : [60]).map((length) =>
    encodeReadAloudFrame({ type: "piece", seconds: length, mp3: new TextEncoder().encode(`mp3-${length}`) }),
  );
  // No record id, so no timing report joins the requests these tests count.
  const done = encodeReadAloudFrame({ type: "done", recordId: null, cached: false });
  const frames = [...pieces, done];
  const body = new Uint8Array(frames.reduce((total, frame) => total + frame.length, 0));
  frames.reduce((offset, frame) => (body.set(frame, offset), offset + frame.length), 0);
  return new Response(body, { headers: { "Content-Type": READ_ALOUD_STREAM_CONTENT_TYPE } });
};

/** A read whose frames the test sends one by one. */
function controlledRead() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  const send = (frame: Parameters<typeof encodeReadAloudFrame>[0]) =>
    act(async () => {
      controller.enqueue(encodeReadAloudFrame(frame));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  return {
    response: new Response(body, { headers: { "Content-Type": READ_ALOUD_STREAM_CONTENT_TYPE } }),
    piece: (seconds: number) => send({ type: "piece", seconds, mp3: new TextEncoder().encode(`mp3-${seconds}`) }),
    done: () => send({ type: "done", recordId: "rec-1", cached: false }),
    fail: (message: string) => send({ type: "error", message }),
  };
}

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
    await respond(mp3(60));
    const audio = lastAudio();

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

  it("starts playing the first piece while the rest is still being made, then plays the pieces back to back", async () => {
    // The point of streaming: audio starts with the first piece instead of after the whole message.
    const { respond } = deferredFetch();
    const read = controlledRead();
    const state = renderHook(() => player.useReadAloudState("m1"));
    const playback = renderHook(() => player.useReadAloudPlayback());
    act(() => player.startReadAloud(input));
    await respond(read.response);
    expect(state.result.current?.status).toBe("preparing");

    await read.piece(2);
    expect(state.result.current?.status).toBe("ready");
    expect(srcAtPlay.at(-1)).toBe("blob:reply-audio-1");
    // The seek bar covers what has arrived so far.
    expect(playback.result.current.duration).toBe(2);

    await read.piece(3);
    expect(playback.result.current.duration).toBe(5);
    const audio = lastAudio();
    act(() => {
      audio.dispatchEvent(new Event("ended"));
    });
    await vi.waitFor(() => expect(srcAtPlay.at(-1)).toBe("blob:reply-audio-2"));
    audio.currentTime = 1;
    act(() => {
      audio.dispatchEvent(new Event("timeupdate"));
    });
    // Two seconds of the first piece plus one of the second.
    expect(playback.result.current.currentTime).toBe(3);
    // When the read is complete, the browser's timing goes to its debug record.
    const fetchMock = vi.mocked(fetch);
    await read.done();
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === "/api/read-aloud/records/rec-1/client-timing")).toBe(true),
    );
  });

  it("waits at the end of a piece for the next one, and goes on by itself when it arrives", async () => {
    const { respond } = deferredFetch();
    const read = controlledRead();
    const playback = renderHook(() => player.useReadAloudPlayback());
    act(() => player.startReadAloud(input));
    await respond(read.response);
    await read.piece(2);
    act(() => {
      lastAudio().dispatchEvent(new Event("ended"));
    });
    // Still counts as playing, not paused, while the next piece is on its way.
    expect(playback.result.current.paused).toBe(false);
    await read.piece(4);
    await vi.waitFor(() => expect(srcAtPlay.at(-1)).toBe("blob:reply-audio-2"));
    await read.done();
  });

  it("seeks across pieces, within the audio received so far", async () => {
    const { respond } = deferredFetch();
    act(() => player.startReadAloud(input));
    await respond(mp3(10, 20, 30));
    const audio = lastAudio();

    act(() => player.seekReadAloud(15));
    expect(audio.src).toBe("blob:reply-audio-2");
    await act(async () => {
      audio.dispatchEvent(new Event("loadedmetadata"));
    });
    expect(audio.currentTime).toBe(5);
    act(() => player.seekReadAloud(500));
    await act(async () => {
      audio.dispatchEvent(new Event("loadedmetadata"));
    });
    expect(audio.src).toBe("blob:reply-audio-3");
    expect(audio.currentTime).toBe(30);
  });

  it("plays what arrived when a read fails midway, then shows the error", async () => {
    const { respond } = deferredFetch();
    const read = controlledRead();
    const { result } = renderHook(() => player.useReadAloudState("m1"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    act(() => player.startReadAloud(input));
    await respond(read.response);
    await read.piece(2);
    await read.fail("Read aloud failed. quota");
    expect(result.current?.status).toBe("ready");
    act(() => {
      lastAudio().dispatchEvent(new Event("ended"));
    });
    await vi.waitFor(() =>
      expect(result.current).toMatchObject({ status: "error", error: "Read aloud failed. quota" }),
    );
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
    await respond(mp3(40));
    const audio = lastAudio();
    audio.currentTime = 10;

    act(() => player.setReadAloudVoice("cedar"));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).voice).toBe("cedar");
    await respond(mp3(40));
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
    await respond(mp3(40));
    const audio = lastAudio();
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

  it("plays a deck slide by slide: each slide's narration, the next fetched ahead, moving on when one ends", async () => {
    // Playing a deck reads one slide at a time, from its notes, and turns to the next slide when the
    // audio ends; the following slide's audio is asked for while the current one plays.
    const { fetchMock, respond } = deferredFetch();
    const { result } = renderHook(() => player.useReadAloudState("deck"));
    const deck = {
      sessionId: "s1",
      messageId: "deck",
      title: "Deck",
      slides: [
        { narration: "Intro script.", shown: "# Deck" },
        { narration: "Second script.", shown: "## Two" },
        { narration: "## Three", shown: "## Three" },
      ],
    };
    const body = (call: number) => JSON.parse(String(fetchMock.mock.calls[call][1].body));

    act(() => player.playDeck(deck, 0));
    expect(result.current).toMatchObject({ status: "preparing", slide: { index: 0, count: 3 } });
    expect(body(0)).toMatchObject({ messageId: "deck", text: "Intro script.", slide: { shown: "# Deck" } });

    await respond(mp3());
    expect(result.current).toMatchObject({ status: "ready", slide: { index: 0 } });
    // The second slide is being prepared ahead.
    expect(body(1)).toMatchObject({ text: "Second script.", slide: { shown: "## Two" } });
    await respond(mp3());

    act(() => {
      lastAudio().dispatchEvent(new Event("ended"));
    });
    // Its audio was already there: no new request for slide two, which now plays.
    await vi.waitFor(() => expect(result.current).toMatchObject({ status: "ready", slide: { index: 1 } }));
    expect(srcAtPlay.at(-1)).toBe("blob:reply-audio-2");
    expect(body(2)).toMatchObject({ text: "## Three" });

    // Going back plays slide one again from its saved audio.
    act(() => player.goToPlayedSlide(0));
    await vi.waitFor(() => expect(result.current).toMatchObject({ status: "ready", slide: { index: 0 } }));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    act(() => player.stopReadAloud());
    expect(result.current).toBeNull();
    expect((fetchMock.mock.calls[2][1].signal as AbortSignal).aborted).toBe(true);
  });

  it("stays on the last slide when the deck ends", async () => {
    const { respond } = deferredFetch();
    const { result } = renderHook(() => player.useReadAloudState("deck"));
    act(() =>
      player.playDeck(
        { sessionId: "s1", messageId: "deck", title: "Deck", slides: [{ narration: "a", shown: "a" }] },
        0,
      ),
    );
    await respond(mp3());
    act(() => {
      lastAudio().dispatchEvent(new Event("ended"));
    });
    expect(result.current).toMatchObject({ status: "ready", slide: { index: 0, count: 1 } });
  });
});
