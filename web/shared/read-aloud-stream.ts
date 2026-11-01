/**
 * The audio of one Read aloud, sent while it is being made: the server writes each piece's MP3 as
 * soon as it is ready, so the browser can play the first piece while later ones are still spoken.
 *
 * The response body is a series of frames, each a 4-byte big-endian header length, the header as
 * JSON, then the header's `bytes` of audio (none for "done" and "error"):
 * - `piece`: one piece's complete MP3 and how many seconds it lasts, in text order.
 * - `done`: the read is complete; `recordId` names its debug record, `cached` that it was saved audio.
 * - `error`: the read failed after the response had started; earlier pieces stay playable.
 */
export const READ_ALOUD_STREAM_CONTENT_TYPE = "application/vnd.takode.read-aloud-stream";

export type ReadAloudStreamHeader =
  | { type: "piece"; seconds: number; bytes: number }
  | { type: "done"; recordId: string | null; cached: boolean }
  | { type: "error"; message: string };

export type ReadAloudStreamFrame =
  | { type: "piece"; seconds: number; mp3: Uint8Array<ArrayBuffer> }
  | { type: "done"; recordId: string | null; cached: boolean }
  | { type: "error"; message: string };

/** One frame, ready to write to the response. */
export function encodeReadAloudFrame(frame: ReadAloudStreamFrame): Uint8Array<ArrayBuffer> {
  const header: ReadAloudStreamHeader =
    frame.type === "piece" ? { type: "piece", seconds: frame.seconds, bytes: frame.mp3.length } : frame;
  const json = new TextEncoder().encode(JSON.stringify(header));
  const audio = frame.type === "piece" ? frame.mp3 : new Uint8Array(0);
  const out = new Uint8Array(4 + json.length + audio.length);
  new DataView(out.buffer).setUint32(0, json.length);
  out.set(json, 4);
  out.set(audio, 4 + json.length);
  return out;
}

/** Reads frames from response chunks however the network split them. */
export class ReadAloudStreamDecoder {
  private buffer = new Uint8Array(0);

  /** Frames completed by `chunk`, in order. */
  push(chunk: Uint8Array): ReadAloudStreamFrame[] {
    const joined = new Uint8Array(this.buffer.length + chunk.length);
    joined.set(this.buffer);
    joined.set(chunk, this.buffer.length);
    this.buffer = joined;
    const frames: ReadAloudStreamFrame[] = [];
    for (;;) {
      if (this.buffer.length < 4) break;
      const headerLength = new DataView(this.buffer.buffer, this.buffer.byteOffset).getUint32(0);
      if (this.buffer.length < 4 + headerLength) break;
      const header = JSON.parse(
        new TextDecoder().decode(this.buffer.subarray(4, 4 + headerLength)),
      ) as ReadAloudStreamHeader;
      const audioLength = header.type === "piece" ? header.bytes : 0;
      const end = 4 + headerLength + audioLength;
      if (this.buffer.length < end) break;
      frames.push(
        header.type === "piece"
          ? { type: "piece", seconds: header.seconds, mp3: this.buffer.slice(4 + headerLength, end) }
          : header,
      );
      this.buffer = this.buffer.slice(end);
    }
    return frames;
  }

  /** True when bytes of an unfinished frame are left over. */
  get pending(): boolean {
    return this.buffer.length > 0;
  }
}
