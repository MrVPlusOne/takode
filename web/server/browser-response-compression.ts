import { promisify } from "node:util";
import { gzip as gzipCallback } from "node:zlib";
import type { Context, MiddlewareHandler } from "hono";
import { API_PROXY_RELAYS_ENCODING_HEADER } from "../shared/host-protocol.js";

const gzip = promisify(gzipCallback);

/** Smaller JSON bodies gain too little from gzip to be worth it. */
const COMPRESS_MIN_BYTES = 1024;

/** Whether an `Accept-Encoding` header accepts gzip, directly or through `*`. */
function acceptsGzip(header: string | undefined): boolean {
  if (!header) return false;
  let wildcard = false;
  for (const part of header.split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    const refused = params.some((param) => /^\s*q\s*=\s*0(\.0*)?\s*$/.test(param));
    if (name === "gzip") return !refused;
    if (name === "*") wildcard = !refused;
  }
  return wildcard;
}

async function gzipJsonResponse(c: Context, next: () => Promise<void>): Promise<void> {
  await next();
  const res = c.res;
  if (
    c.req.method === "HEAD" ||
    res.status === 206 ||
    !res.body ||
    res.headers.has("Content-Encoding") ||
    !/^application\/json/i.test(res.headers.get("Content-Type") ?? "") ||
    /(?:^|,)\s*no-transform\s*(?:,|$)/i.test(res.headers.get("Cache-Control") ?? "")
  ) {
    return;
  }
  const vary = res.headers.get("Vary");
  if (vary !== "*" && !/(?:^|,)\s*accept-encoding\s*(?:,|$)/i.test(vary ?? "")) {
    res.headers.set("Vary", vary ? `${vary}, Accept-Encoding` : "Accept-Encoding");
  }
  if (!acceptsGzip(c.req.header("accept-encoding"))) return;

  const raw = new Uint8Array(await res.arrayBuffer());
  const compress = raw.byteLength >= COMPRESS_MIN_BYTES;
  const body = compress ? await gzip(raw) : raw;
  c.res = new Response(body, res);
  if (!compress) return;
  c.res.headers.set("Content-Encoding", "gzip");
  c.res.headers.set("Content-Length", String(body.byteLength));
  const etag = c.res.headers.get("ETag");
  if (etag && !etag.startsWith("W/")) c.res.headers.set("ETag", `W/${etag}`);
}

/**
 * Compress JSON API responses for clients that can take them. When a browser
 * or a remote host reaches the server over a slow link, large reads such as
 * the session or quest lists are several times smaller gzipped.
 *
 * The whole body is compressed before sending, with its length, instead of
 * streamed through a `CompressionStream`: Bun 1.3.10 corrupts a streamed body
 * sent to an HTTP/1.0 client, and nginx, which carries the phone's traffic
 * through the relay, talks HTTP/1.0 to its upstream by default. The streamed
 * version left the phone's session and quest lists empty. Compression runs on
 * zlib's thread pool, off the event loop.
 *
 * Browsers are recognized by the `Sec-Fetch-Mode` header every current
 * browser sends and Bun's fetch never does. Agent CLIs on a host reach the
 * server through their `takode node` API proxy, and only proxies that say they
 * relay encoded bodies as they are get compressed answers: older proxies
 * forward Bun's fetch response, which decodes the body but keeps its
 * `Content-Encoding`, so compressing for agent CLIs behind them would corrupt
 * their reads. CLIs that call the server directly get plain answers.
 */
export const compressApiJson: MiddlewareHandler = (c, next) =>
  c.req.header("sec-fetch-mode") || c.req.header(API_PROXY_RELAYS_ENCODING_HEADER) ? gzipJsonResponse(c, next) : next();
