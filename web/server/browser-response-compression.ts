import type { MiddlewareHandler } from "hono";
import { compress } from "hono/compress";
import { API_PROXY_RELAYS_ENCODING_HEADER } from "../shared/host-protocol.js";

const compressJson = compress({ contentTypeFilter: /^application\/json/ });

/**
 * Compress JSON API responses for clients that can take them. When a browser
 * or a remote host reaches the server over a slow link, large reads such as
 * the session or quest lists are several times smaller gzipped.
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
  c.req.header("sec-fetch-mode") || c.req.header(API_PROXY_RELAYS_ENCODING_HEADER) ? compressJson(c, next) : next();
