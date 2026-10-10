import { HostLinkCodec, processBytes, processData } from "./host-link-codec.js";

/** A sender and a receiver codec for one direction of a connection, both with `deflate` on. */
function pair(): { sender: HostLinkCodec; receiver: HostLinkCodec } {
  const sender = new HostLinkCodec();
  const receiver = new HostLinkCodec();
  sender.enable(["text", "deflate"]);
  receiver.enable(["text", "deflate"]);
  return { sender, receiver };
}

function frameBytes(frame: string | Uint8Array): number {
  return typeof frame === "string" ? Buffer.byteLength(frame) : frame.length;
}

describe("HostLinkCodec", () => {
  // Without `deflate` accepted on the connection, messages stay plain JSON
  // text, which is all an older host or coordinator understands.
  it("sends plain JSON until deflate is enabled", () => {
    const codec = new HostLinkCodec();
    const message = { t: "event", procId: "p", seq: 1, event: { kind: "stdout", text: "x".repeat(500) } };
    expect(codec.encode(message)).toBe(JSON.stringify(message));
    codec.enable(["text"]);
    expect(codec.encode(message)).toBe(JSON.stringify(message));
  });

  // The receiver decodes every message exactly, across a long stream that
  // includes tiny messages (kept as text), messages larger than the 32 KiB
  // history, and non-ASCII text, because both sides slide the same history.
  it("round-trips a long stream of messages of every size", () => {
    const { sender, receiver } = pair();
    const messages: unknown[] = [];
    for (let index = 0; index < 300; index++) {
      if (index % 50 === 7) messages.push({ t: "event", seq: index, event: { text: "big ".repeat(20_000) + index } });
      else if (index % 3 === 0) messages.push({ t: "heartbeat" });
      else
        messages.push({ t: "event", procId: "p1", seq: index, event: { kind: "stdout", text: `línea ${index} ✓\n` } });
    }
    for (const message of messages) {
      const frame = sender.encode(message);
      if ((message as { t: string }).t === "heartbeat") expect(typeof frame).toBe("string");
      expect(JSON.parse(receiver.decode(frame))).toEqual(message);
    }
  });

  // The point of keeping a history: the many small, repetitive process events
  // compress against earlier ones, which compressing each on its own cannot do.
  it("compresses a repeated message far below its size", () => {
    const { sender, receiver } = pair();
    const message = {
      t: "event",
      procId: "0b0d7e7c-8f0a-4f2a-9a55-2d8e3c3c1f1a",
      seq: 1,
      event: { kind: "stdout", text: '{"type":"assistant","session_id":"7f47e6ee-1aee-4437-9773-5d772243a2e9"}\n' },
    };
    const first = sender.encode(message);
    receiver.decode(first);
    const second = sender.encode({ ...message, seq: 2 });
    expect(frameBytes(second)).toBeLessThan(25);
    expect(frameBytes(second)).toBeLessThan(JSON.stringify(message).length / 5);
    expect(JSON.parse(receiver.decode(second))).toEqual({ ...message, seq: 2 });
  });

  // A frame that is not valid compressed data fails loudly, so the link can
  // start over instead of acting on garbage.
  it("throws on a binary frame that is not valid compressed data", () => {
    const { receiver } = pair();
    expect(() => JSON.parse(receiver.decode(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x00])))).toThrow();
  });
});

describe("processData", () => {
  // Output that is valid UTF-8 travels as text, which compresses better than base64.
  it("carries valid UTF-8 as text and keeps the exact bytes, including a byte order mark", () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"text":"naïve ✓"}\n')]);
    const value = processData(bytes.toString("base64"), true);
    expect(value).toEqual({ text: "﻿" + '{"text":"naïve ✓"}\n' });
    expect(processBytes(value).equals(bytes)).toBe(true);
  });

  // A pipe read can end inside a multi-byte character; such a chunk, and any
  // binary output, stays base64 so no byte is changed.
  it("keeps bytes that are not valid UTF-8 as base64", () => {
    const split = Buffer.from("✓", "utf-8").subarray(0, 2);
    const value = processData(split.toString("base64"), true);
    expect(value).toEqual({ data: split.toString("base64") });
    expect(processBytes(value).equals(split)).toBe(true);
  });

  it("uses base64 when the connection did not accept text", () => {
    const base64 = Buffer.from("hello").toString("base64");
    expect(processData(base64, false)).toEqual({ data: base64 });
  });
});
