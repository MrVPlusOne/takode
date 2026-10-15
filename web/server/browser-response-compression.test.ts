import { connect } from "node:net";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { API_PROXY_RELAYS_ENCODING_HEADER } from "../shared/host-protocol.js";
import { compressApiJson } from "./browser-response-compression.js";

// A JSON body well above the compression threshold, like the session list.
const LARGE = { sessions: Array.from({ length: 200 }, (_, index) => ({ id: `session-${index}`, name: "same text" })) };

/**
 * Send one HTTP/1.0 GET over a raw socket and return what the server sent: up
 * to the end of a Content-Length body, or until the server closes or goes quiet.
 */
function rawHttp10Get(port: number, path: string, headers: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(`GET ${path} HTTP/1.0\r\nHost: 127.0.0.1\r\n${headers}\r\n\r\n`);
    });
    let received = Buffer.alloc(0);
    const finish = () => {
      socket.destroy();
      resolve(received);
    };
    socket.on("data", (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      const split = received.indexOf("\r\n\r\n");
      const length = /content-length: *(\d+)/i.exec(received.subarray(0, split).toString("latin1"))?.[1];
      if (split >= 0 && length && received.length - split - 4 >= Number(length)) finish();
    });
    socket.on("end", finish);
    // A streamed body sent to an HTTP/1.0 client may never end; fail on what arrived.
    socket.setTimeout(2_000, finish);
    socket.on("error", reject);
  });
}

function app(): Hono {
  const app = new Hono();
  app.use("/api/*", compressApiJson);
  app.get("/api/sessions", (c) => c.json(LARGE));
  return app;
}

describe("compressApiJson", () => {
  it("gzips large JSON for browsers and the body decodes to the same JSON", async () => {
    const response = await app().request("/api/sessions", {
      headers: { "accept-encoding": "gzip", "sec-fetch-mode": "cors" },
    });
    expect(response.headers.get("content-encoding")).toBe("gzip");
    const decoded = Bun.gunzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(JSON.parse(new TextDecoder().decode(decoded))).toEqual(LARGE);
  });

  it("leaves agent CLI requests uncompressed, because older host proxies cannot relay encoded bodies", async () => {
    // Bun's fetch sends Accept-Encoding but no Sec-Fetch-Mode.
    const response = await app().request("/api/sessions", { headers: { "accept-encoding": "gzip" } });
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.json()).toEqual(LARGE);
  });

  // The phone reaches the server through an nginx reverse proxy, which talks
  // HTTP/1.0 to its upstream by default. Bun 1.3.10 corrupts a streamed
  // (CompressionStream) body for HTTP/1.0 clients, so the phone's session and
  // quest lists failed to decode and showed empty while the laptop, on HTTP/1.1,
  // was fine. A real server and a raw HTTP/1.0 request cover that path.
  it("serves a complete gzip body with a length to an HTTP/1.0 client such as an nginx proxy", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app().fetch });
    try {
      const raw = await rawHttp10Get(
        server.port!,
        "/api/sessions",
        "Accept-Encoding: gzip\r\nSec-Fetch-Mode: cors\r\nConnection: close",
      );
      const split = raw.indexOf("\r\n\r\n");
      const head = raw.subarray(0, split).toString("latin1").toLowerCase();
      const body = raw.subarray(split + 4);
      expect(head).toContain("content-encoding: gzip");
      expect(head).toContain(`content-length: ${body.length}`);
      expect(JSON.parse(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(body))))).toEqual(LARGE);
    } finally {
      server.stop(true);
    }
  });

  it("leaves small JSON uncompressed and still honors a client that refuses gzip", async () => {
    const small = new Hono();
    small.use("/api/*", compressApiJson);
    small.get("/api/small", (c) => c.json({ ok: true }));
    const tiny = await small.request("/api/small", {
      headers: { "accept-encoding": "gzip", "sec-fetch-mode": "cors" },
    });
    expect(tiny.headers.get("content-encoding")).toBeNull();
    expect(await tiny.json()).toEqual({ ok: true });

    const refused = await app().request("/api/sessions", {
      headers: { "accept-encoding": "gzip;q=0, identity", "sec-fetch-mode": "cors" },
    });
    expect(refused.headers.get("content-encoding")).toBeNull();
    expect(await refused.json()).toEqual(LARGE);
  });

  it("gzips for a host API proxy that relays encoded bodies, so agent CLIs on slow hosts get small answers", async () => {
    const response = await app().request("/api/sessions", {
      headers: { "accept-encoding": "gzip", [API_PROXY_RELAYS_ENCODING_HEADER]: "1" },
    });
    expect(response.headers.get("content-encoding")).toBe("gzip");
    const decoded = Bun.gunzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(JSON.parse(new TextDecoder().decode(decoded))).toEqual(LARGE);
  });
});

// Re-reads on a slow link should cost a round trip, not the body: browser GETs
// of JSON without a route-set validator get an ETag and private no-cache, and
// a matching If-None-Match is a bodyless 304. Routes that set their own cache
// policy (such as the no-store session list) and agent CLIs are left alone.
describe("browser JSON revalidation", () => {
  const browser = { "accept-encoding": "gzip", "sec-fetch-mode": "cors" };

  function revalidatingApp(): Hono {
    let version = 1;
    const app = new Hono();
    app.use("/api/*", compressApiJson);
    app.get("/api/titles", (c) => c.json({ version, ...LARGE }));
    app.get("/api/small", (c) => c.json({ version }));
    app.post("/api/bump", (c) => {
      version += 1;
      return c.json({ version });
    });
    app.get("/api/own-policy", (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(LARGE);
    });
    return app;
  }

  it("answers an unchanged re-read with a 304 and a changed one with the new body", async () => {
    const app = revalidatingApp();
    const first = await app.request("/api/titles", { headers: browser });
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^W\/"/);
    expect(first.headers.get("cache-control")).toBe("private, no-cache");
    expect(first.headers.get("content-encoding")).toBe("gzip");

    const again = await app.request("/api/titles", { headers: { ...browser, "if-none-match": etag! } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect(again.headers.get("etag")).toBe(etag);

    await app.request("/api/bump", { method: "POST", headers: browser });
    const changed = await app.request("/api/titles", { headers: { ...browser, "if-none-match": etag! } });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);
    expect(
      JSON.parse(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await changed.arrayBuffer())))),
    ).toMatchObject({
      version: 2,
    });
  });

  it("revalidates small bodies too, which stay uncompressed", async () => {
    const app = revalidatingApp();
    const first = await app.request("/api/small", { headers: browser });
    expect(first.headers.get("content-encoding")).toBeNull();
    expect(await first.json()).toEqual({ version: 1 });
    const again = await app.request("/api/small", {
      headers: { ...browser, "if-none-match": first.headers.get("etag")! },
    });
    expect(again.status).toBe(304);
  });

  it("leaves routes with their own cache policy, non-GETs and agent CLIs without a validator", async () => {
    const app = revalidatingApp();
    const own = await app.request("/api/own-policy", { headers: browser });
    expect(own.headers.get("etag")).toBeNull();
    expect(own.headers.get("cache-control")).toBe("no-store");
    const post = await app.request("/api/bump", { method: "POST", headers: browser });
    expect(post.headers.get("etag")).toBeNull();
    const cli = await app.request("/api/titles", { headers: { "accept-encoding": "gzip" } });
    expect(cli.headers.get("etag")).toBeNull();
  });
});
