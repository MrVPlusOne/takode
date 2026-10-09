import type { MiddlewareHandler } from "hono";
import { compress } from "hono/compress";

const compressJson = compress({ contentTypeFilter: /^application\/json/ });

/**
 * Compress JSON API responses for browsers. When the browser reaches the
 * server over a slow link, large reads such as the session list are several
 * times smaller gzipped.
 *
 * Only browsers get it, recognized by the `Sec-Fetch-Mode` header every
 * current browser sends and Bun's fetch never does. Older `takode node` API
 * proxies forward Bun's fetch response, which decodes the body but keeps its
 * `Content-Encoding`, so compressing for agent CLIs behind them would corrupt
 * their reads.
 */
export const compressBrowserJson: MiddlewareHandler = (c, next) =>
  c.req.header("sec-fetch-mode") ? compressJson(c, next) : next();
