import { describe, expect, it } from "vitest";
import { ReadAloudStreamDecoder, encodeReadAloudFrame } from "./read-aloud-stream.js";

/**
 * The streamed Read aloud format: frames must come out whole and in order however the network
 * splits the bytes, since the browser plays each piece as soon as its last byte is here.
 */
describe("read-aloud stream frames", () => {
  it("decodes pieces, the end and errors, split at any byte", () => {
    const mp3 = new Uint8Array([0xff, 0xfb, 1, 2, 3]);
    const bytes = new Uint8Array([
      ...encodeReadAloudFrame({ type: "piece", seconds: 1.5, mp3 }),
      ...encodeReadAloudFrame({ type: "piece", seconds: 2, mp3: new Uint8Array([9]) }),
      ...encodeReadAloudFrame({ type: "error", message: "Read aloud failed. quota" }),
      ...encodeReadAloudFrame({ type: "done", recordId: "r1", cached: true }),
    ]);
    for (const size of [1, 3, 7, bytes.length]) {
      const decoder = new ReadAloudStreamDecoder();
      const frames = [];
      for (let start = 0; start < bytes.length; start += size)
        frames.push(...decoder.push(bytes.slice(start, start + size)));
      expect(frames).toEqual([
        { type: "piece", seconds: 1.5, mp3 },
        { type: "piece", seconds: 2, mp3: new Uint8Array([9]) },
        { type: "error", message: "Read aloud failed. quota" },
        { type: "done", recordId: "r1", cached: true },
      ]);
      expect(decoder.pending).toBe(false);
    }
  });

  it("keeps an unfinished frame until the rest of it arrives", () => {
    const bytes = encodeReadAloudFrame({ type: "piece", seconds: 1, mp3: new Uint8Array(100) });
    const decoder = new ReadAloudStreamDecoder();
    expect(decoder.push(bytes.slice(0, 50))).toEqual([]);
    expect(decoder.pending).toBe(true);
    expect(decoder.push(bytes.slice(50))).toHaveLength(1);
  });
});
