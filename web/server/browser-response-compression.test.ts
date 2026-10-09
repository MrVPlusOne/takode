import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { compressBrowserJson } from "./browser-response-compression.js";

// A JSON body well above the compression threshold, like the session list.
const LARGE = { sessions: Array.from({ length: 200 }, (_, index) => ({ id: `session-${index}`, name: "same text" })) };

function app(): Hono {
  const app = new Hono();
  app.use("/api/*", compressBrowserJson);
  app.get("/api/sessions", (c) => c.json(LARGE));
  return app;
}

describe("compressBrowserJson", () => {
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
});
