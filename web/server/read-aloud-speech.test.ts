import { afterEach, describe, expect, it, vi } from "vitest";
import { SpeechJob } from "./read-aloud-speech.js";

/** One second of 24 kHz 16-bit silence. */
const SECOND_OF_PCM = new Uint8Array(24_000 * 2);

/** Speech requests the test answers by hand, in any order. */
function manualSpeech() {
  const calls: Array<{
    text: string;
    signal: AbortSignal;
    resolve: (pcm: Uint8Array) => void;
    reject: (error: Error) => void;
  }> = [];
  const fetchPcm = vi.fn(
    (text: string, signal: AbortSignal) =>
      new Promise<Uint8Array>((resolve, reject) => {
        calls.push({ text, signal, resolve, reject });
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  return { calls, fetchPcm };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SpeechJob", () => {
  it("asks for each piece twice, takes the first answer and cancels the other", async () => {
    // About one speech request in four streams far slower than real time.
    const { calls, fetchPcm } = manualSpeech();
    const job = new SpeechJob(fetchPcm);
    job.add("Hello.");
    expect(calls.map((call) => call.text)).toEqual(["Hello.", "Hello."]);

    calls[1].resolve(SECOND_OF_PCM);
    const audio = await job.finish();

    expect(calls[0].signal.aborted).toBe(true);
    expect(audio[0]).toBe(0xff);
    expect(job.requests).toBe(2);
  });

  it("asks again every 5 seconds while no answer has come, up to four requests", async () => {
    // Only intervals: encoding yields with setImmediate, which must keep running.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { calls, fetchPcm } = manualSpeech();
    const job = new SpeechJob(fetchPcm);
    job.add("Slow piece.");
    await vi.advanceTimersByTimeAsync(4_999);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(4);

    calls[3].resolve(SECOND_OF_PCM);
    await job.finish();
    expect(calls.slice(0, 3).every((call) => call.signal.aborted)).toBe(true);
  });

  it("waits longer before asking again for a long piece, and can start with one request", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { calls, fetchPcm } = manualSpeech();
    const job = new SpeechJob(fetchPcm, { initialRequests: 1 });
    job.add("x".repeat(1000)); // 12 s between requests
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(11_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    calls[0].resolve(SECOND_OF_PCM);
    await job.finish();
  });

  it("joins pieces in text order whatever order they arrive in", async () => {
    const { calls, fetchPcm } = manualSpeech();
    const job = new SpeechJob(fetchPcm);
    job.add("First.");
    job.add("Second.");
    // Second piece (calls 2-3) answers first with two seconds, first piece with one.
    calls[2].resolve(new Uint8Array(SECOND_OF_PCM.length * 2));
    calls[0].resolve(SECOND_OF_PCM);
    const audio = await job.finish();
    // Three seconds at 48 kbps is about 18 KB.
    expect(audio.length).toBeGreaterThan(16_000);
    expect(audio.length).toBeLessThan(20_000);
    expect(job.pieces).toBe(2);
  });

  it("retries a piece whose requests both failed, then gives up with the error", async () => {
    const { calls, fetchPcm } = manualSpeech();
    const job = new SpeechJob(fetchPcm);
    job.add("Unlucky.");
    calls[0].reject(new Error("OpenAI /audio/speech failed with 500"));
    calls[1].reject(new Error("OpenAI /audio/speech failed with 500"));
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    calls[2].reject(new Error("OpenAI /audio/speech failed with 502"));
    await vi.waitFor(() => expect(calls).toHaveLength(4));
    calls[3].reject(new Error("OpenAI /audio/speech failed with 503"));
    await expect(job.finish()).rejects.toThrow("failed with 503");
  });

  it("cancels every request when the caller gives up", async () => {
    const { calls, fetchPcm } = manualSpeech();
    const caller = new AbortController();
    const job = new SpeechJob(fetchPcm, { signal: caller.signal });
    job.add("One.");
    job.add("Two.");
    caller.abort();
    await expect(job.finish()).rejects.toThrow("aborted");
    expect(calls.every((call) => call.signal.aborted)).toBe(true);
  });
});
