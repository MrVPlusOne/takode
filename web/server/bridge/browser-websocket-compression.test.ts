import net from "node:net";
import { constants, createInflateRaw } from "node:zlib";
import {
  BROWSER_COMPRESS_MIN_BYTES,
  BROWSER_WEBSOCKET_COMPRESSION,
  classifyBrowserClientPlatform,
  sendObservedBrowserPayload,
} from "./browser-connection-diagnostics.js";

/** A history-window-like payload well above the compression threshold. */
const LARGE = JSON.stringify({
  type: "history_window_sync",
  messages: Array.from({ length: 300 }, (_, index) => ({
    id: `m${index}`,
    text: `Message ${index} about the bridge.`,
  })),
});
const SMALL = JSON.stringify({ type: "timer_update", timers: [] });

interface WireFrame {
  compressed: boolean;
  payload: Buffer;
}

/** Read three frames with raw HTTP so compression negotiation stays under test control. */
async function receiveFrames(port: number, offerCompression: boolean): Promise<WireFrame[]> {
  const socket = net.connect(port, "127.0.0.1");
  socket.setTimeout(2_000, () => socket.destroy(new Error("WebSocket frames timed out")));
  socket.write(
    "GET / HTTP/1.1\r\nHost: test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n" +
      (offerCompression ? "Sec-WebSocket-Extensions: permessage-deflate\r\n" : "") +
      "\r\n",
  );
  let buffer = Buffer.alloc(0);
  let upgraded = false;
  const frames: WireFrame[] = [];
  return new Promise((resolve, reject) => {
    socket.on("error", reject);
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        upgraded = true;
        buffer = buffer.subarray(headerEnd + 4);
      }
      // Each iteration consumes a complete frame or returns for more bytes.
      while (frames.length < 3) {
        if (buffer.length < 2) return;
        let length = buffer[1]! & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) return;
          length = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        if (buffer.length < offset + length) return;
        frames.push({ compressed: (buffer[0]! & 0x40) !== 0, payload: buffer.subarray(offset, offset + length) });
        buffer = buffer.subarray(offset + length);
      }
      socket.destroy();
      resolve(frames);
    });
  });
}

describe("browser WebSocket compression", () => {
  // The server enables permessage-deflate, but Bun compresses only messages
  // sent with its `compress` flag; large browser messages set it, small ones
  // skip the cost.
  it("asks Bun to compress large messages and not small ones", () => {
    const ws = { send: vi.fn((_data: string, _compress?: boolean): unknown => 1) };
    sendObservedBrowserPayload(ws, LARGE, "history_window_sync");
    sendObservedBrowserPayload(ws, SMALL, "timer_update");
    expect(LARGE.length).toBeGreaterThan(BROWSER_COMPRESS_MIN_BYTES);
    expect(ws.send.mock.calls).toEqual([
      [LARGE, true],
      [SMALL, false],
    ]);
  });

  // The former iOS opt-out disappears with Safari-compatible compression.
  // Platform metadata remains available for diagnostics only.
  it("compresses large messages for an iOS browser", () => {
    const ws = {
      data: { browserClientPlatform: "ios" },
      send: vi.fn((_data: string, _compress?: boolean): unknown => 1),
    };
    sendObservedBrowserPayload(ws, LARGE, "history_window_sync");
    expect(ws.send.mock.calls).toEqual([[LARGE, true]]);
  });

  // Keep the original real-user-agent cases as regression coverage: previously
  // excluded browsers now get the same size-based compression as every other client.
  it("applies the same compression policy to every browser user agent", () => {
    const webKit = [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.2 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/154.0.0.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Safari/605.1.15",
    ];
    const other = [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0",
      "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0",
    ];
    for (const userAgent of [...webKit, ...other, null]) {
      const ws = {
        data: { browserClientPlatform: classifyBrowserClientPlatform(userAgent) },
        send: vi.fn((_data: string, _compress?: boolean): unknown => 1),
      };
      sendObservedBrowserPayload(ws, LARGE, "history_window_sync");
      sendObservedBrowserPayload(ws, SMALL, "timer_update");
      expect(ws.send.mock.calls).toEqual([
        [LARGE, true],
        [SMALL, false],
      ]);
    }
  });

  // With a real Bun server: a browser that negotiated compression receives a
  // compressed frame with the same content, and a client that did not (an
  // older browser or a proxy that drops the extension header) still gets the
  // plain message, so the flag is safe to pass to every browser socket.
  it("compresses on the wire only for clients that negotiated it, without changing content", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request, bunServer) => (bunServer.upgrade(request) ? undefined : new Response("", { status: 400 })),
      websocket: {
        perMessageDeflate: BROWSER_WEBSOCKET_COMPRESSION,
        open(ws) {
          sendObservedBrowserPayload(ws, LARGE, "history_window_sync");
          sendObservedBrowserPayload(ws, SMALL, "timer_update");
          sendObservedBrowserPayload(ws, LARGE, "history_window_sync");
        },
        message: () => {},
      },
    });
    try {
      const plain = await receiveFrames(server.port!, false);
      expect(plain.map((frame) => frame.compressed)).toEqual([false, false, false]);
      expect(plain.map((frame) => frame.payload.toString("utf8"))).toEqual([LARGE, SMALL, LARGE]);

      const frames = await receiveFrames(server.port!, true);
      expect(frames.map((frame) => frame.compressed)).toEqual([true, false, true]);
      expect(frames[0]!.payload.length).toBeLessThan(LARGE.length / 4);
      const inflater = createInflateRaw();
      let chunks: Buffer[] = [];
      inflater.on("data", (chunk: Buffer) => chunks.push(chunk));
      const received: string[] = [];
      try {
        for (const frame of frames) {
          if (!frame.compressed) {
            received.push(frame.payload.toString("utf8"));
            continue;
          }
          chunks = [];
          await new Promise<void>((resolve, reject) => {
            inflater.once("error", reject);
            // Restore the sync-flush suffix stripped by RFC 7692.
            inflater.write(Buffer.concat([frame.payload, Buffer.from([0, 0, 255, 255])]));
            inflater.flush(constants.Z_SYNC_FLUSH, () => {
              inflater.off("error", reject);
              resolve();
            });
          });
          // BFINAL decodes correctly but ends the inflater. Real Safari then
          // rejects the next plain/control frame. Inspect the actual stream:
          // a payload can contain multiple blocks and reuse its dictionary.
          expect(inflater.readableEnded).toBe(false);
          received.push(Buffer.concat(chunks).toString("utf8"));
        }
      } finally {
        inflater.destroy();
      }
      expect(received).toEqual([LARGE, SMALL, LARGE]);
    } finally {
      server.stop(true);
    }
  });
});
