import net from "node:net";
import {
  BROWSER_COMPRESS_MIN_BYTES,
  isWebKitBrowser,
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

/** First frame of a WebSocket opened with raw HTTP, so the test controls whether compression is offered. */
async function firstFrame(port: number, offerCompression: boolean): Promise<{ compressed: boolean; payload: Buffer }> {
  const socket = net.connect(port, "127.0.0.1");
  socket.write(
    "GET / HTTP/1.1\r\nHost: test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n" +
      (offerCompression ? "Sec-WebSocket-Extensions: permessage-deflate\r\n" : "") +
      "\r\n",
  );
  let buffer = Buffer.alloc(0);
  return new Promise((resolve, reject) => {
    socket.on("error", reject);
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const frame = buffer.subarray(headerEnd + 4);
      if (frame.length < 2) return;
      let length = frame[1]! & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (frame.length < 4) return;
        length = frame.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (frame.length < 10) return;
        length = Number(frame.readBigUInt64BE(2));
        offset = 10;
      }
      if (frame.length < offset + length) return;
      socket.destroy();
      resolve({ compressed: (frame[0]! & 0x40) !== 0, payload: frame.subarray(offset, offset + length) });
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

  // Safari and every iPhone browser negotiate permessage-deflate, but their
  // sockets closed right after the first message Bun compressed, so on the phone
  // no session finished connecting. Sockets marked WebKit at upgrade are never
  // sent compressed messages.
  it("never asks Bun to compress for a WebKit browser", () => {
    const ws = { data: { browserWebKit: true }, send: vi.fn((_data: string, _compress?: boolean): unknown => 1) };
    sendObservedBrowserPayload(ws, LARGE, "history_window_sync");
    expect(ws.send.mock.calls).toEqual([[LARGE, false]]);
  });

  // Real user agents: iPhone Safari (from the phone's logs), Chrome and Firefox
  // on iPhone (WebKit underneath), and Safari on a Mac are WebKit; desktop and
  // Android Chrome, Edge and Firefox are not.
  it("recognizes WebKit browsers by user agent", () => {
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
    expect(webKit.map(isWebKitBrowser)).toEqual(webKit.map(() => true));
    expect(other.map(isWebKitBrowser)).toEqual(other.map(() => false));
    expect(isWebKitBrowser(null)).toBe(false);
  });

  // With a real Bun server: a browser that negotiated compression receives a
  // compressed frame with the same content, and a client that did not (an
  // older browser or a proxy that drops the extension header) still gets the
  // plain message, so the flag is safe to pass to every browser socket.
  it("compresses on the wire only for clients that negotiated it, without changing content", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: (request, bunServer) => (bunServer.upgrade(request) ? undefined : new Response("", { status: 400 })),
      websocket: {
        perMessageDeflate: true,
        open: (ws) => void sendObservedBrowserPayload(ws, LARGE, "history_window_sync"),
        message: () => {},
      },
    });
    try {
      const plain = await firstFrame(server.port!, false);
      expect(plain.compressed).toBe(false);
      expect(plain.payload.toString("utf-8")).toBe(LARGE);

      const compressed = await firstFrame(server.port!, true);
      expect(compressed.compressed).toBe(true);
      expect(compressed.payload.length).toBeLessThan(LARGE.length / 4);
      const received = await new Promise<string>((resolve) => {
        const client = new WebSocket(`ws://127.0.0.1:${server.port}/`);
        client.onmessage = (event) => {
          resolve(String(event.data));
          client.close();
        };
      });
      expect(received).toBe(LARGE);
    } finally {
      server.stop(true);
    }
  });
});
