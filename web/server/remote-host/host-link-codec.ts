import { constants, deflateRawSync, inflateRawSync } from "node:zlib";
import type { HostLinkFeature, ProcessData } from "../../shared/host-protocol.js";

/** Link features this build can use; both sides offer or accept them (see `host-protocol.ts`). */
export const HOST_LINK_FEATURES: readonly HostLinkFeature[] = ["text", "deflate"];

/** History each direction compresses against, the largest raw deflate window. */
const WINDOW_BYTES = 32 * 1024;

/** Shorter messages, such as heartbeats, stay plain text: they would barely shrink. */
const MIN_DEFLATE_BYTES = 64;

/** Every sync-flushed deflate block ends with these bytes; they are left off the wire, as in permessage-deflate. */
const SYNC_FLUSH_TAIL = Buffer.from([0x00, 0x00, 0xff, 0xff]);

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * Encoding of one host link connection, kept by each side for its socket.
 *
 * Bun's WebSocket permessage-deflate does little here: the server compresses
 * only messages sent with an explicit flag, Bun's client compresses only
 * large messages, and each message is compressed on its own, so the many
 * small, repetitive process events barely shrink. With `deflate` accepted,
 * each side instead compresses a message against the previous 32 KiB of the
 * messages it compressed on this connection, which both sides keep the same
 * way: the sender as it sends, the receiver as it decodes. Frames arrive in
 * order on one WebSocket, so the two histories always match. A new
 * connection starts with empty histories.
 */
export class HostLinkCodec {
  private readonly features = new Set<HostLinkFeature>();
  private sent: Buffer = Buffer.alloc(0);
  private received: Buffer = Buffer.alloc(0);

  /** Start using the features accepted for this connection. */
  enable(features: readonly HostLinkFeature[] | undefined): void {
    for (const feature of features ?? []) if (HOST_LINK_FEATURES.includes(feature)) this.features.add(feature);
  }

  has(feature: HostLinkFeature): boolean {
    return this.features.has(feature);
  }

  /** The frame to send for a message: JSON text, or compressed binary once `deflate` is on. */
  encode(message: unknown): string | Uint8Array {
    const json = JSON.stringify(message);
    if (!this.features.has("deflate") || json.length < MIN_DEFLATE_BYTES) return json;
    const bytes = Buffer.from(json, "utf-8");
    const compressed = deflateRawSync(bytes, {
      finishFlush: constants.Z_SYNC_FLUSH,
      ...(this.sent.length > 0 ? { dictionary: this.sent } : {}),
    });
    this.sent = slide(this.sent, bytes);
    return compressed.subarray(0, compressed.length - SYNC_FLUSH_TAIL.length);
  }

  /** The JSON text of a received frame. Throws when a binary frame cannot be decompressed. */
  decode(frame: string | ArrayBuffer | Uint8Array): string {
    if (typeof frame === "string") return frame;
    const data =
      frame instanceof ArrayBuffer ? Buffer.from(frame) : Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
    const bytes = inflateRawSync(Buffer.concat([data, SYNC_FLUSH_TAIL]), {
      finishFlush: constants.Z_SYNC_FLUSH,
      ...(this.received.length > 0 ? { dictionary: this.received } : {}),
    });
    this.received = slide(this.received, bytes);
    return bytes.toString("utf-8");
  }
}

/** The last {@link WINDOW_BYTES} of `history` followed by `bytes`, copied so a large message is not kept alive. */
function slide(history: Buffer, bytes: Buffer): Buffer {
  if (bytes.length >= WINDOW_BYTES) return Buffer.from(bytes.subarray(bytes.length - WINDOW_BYTES));
  const keep = Math.min(history.length, WINDOW_BYTES - bytes.length);
  return Buffer.concat([history.subarray(history.length - keep), bytes]);
}

/** Process bytes as the link carries them: as `text` when the connection accepted it and they are valid UTF-8. */
export function processData(base64: string, text: boolean): ProcessData {
  if (!text) return { data: base64 };
  try {
    return { text: strictUtf8.decode(Buffer.from(base64, "base64")) };
  } catch {
    // For example, a chunk that ends inside a multi-byte character.
    return { data: base64 };
  }
}

/** The bytes a `stdin`, `stdout` or `stderr` message carries, in either form. */
export function processBytes(value: ProcessData): Buffer {
  return value.text !== undefined ? Buffer.from(value.text, "utf-8") : Buffer.from(value.data, "base64");
}
