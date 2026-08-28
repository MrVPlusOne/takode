import { describe, expect, it } from "vitest";
import { blockOpaqueOriginApplicationRequest } from "./opaque-origin-guard.js";

function request(path: string, origin?: string) {
  return new Request(`http://localhost${path}`, {
    headers: origin === undefined ? undefined : { Origin: origin },
  });
}

describe("opaque-origin application authority guard", () => {
  it("rejects sandboxed document access to application APIs and WebSockets", () => {
    // CSP sandbox documents use the literal null Origin; reject it before either
    // wildcard API CORS or the WebSocket upgrade can grant Takode authority.
    expect(
      blockOpaqueOriginApplicationRequest(request("/api/settings", "null"), { websocketRouteMatched: false }),
    ).toMatchObject({ status: 403 });
    expect(
      blockOpaqueOriginApplicationRequest(request("/ws/browser/session", "null"), { websocketRouteMatched: true }),
    ).toMatchObject({ status: 403 });
    for (const path of [
      "/%61pi/settings",
      "/a%70i/settings",
      "/ap%69/settings",
      "/%2561pi/settings",
      "/safe/../%61pi/settings",
      "/%61pi/foo/%ZZ",
      "/%77s/browser/session",
    ]) {
      expect(
        blockOpaqueOriginApplicationRequest(request(path, "null"), { websocketRouteMatched: false }),
      ).toMatchObject({
        status: 403,
      });
    }
  });

  it("does not block preview assets, normal browser origins, or origin-less CLI requests", () => {
    // The guard is deliberately narrow so normal app/Vite traffic, CLI sockets,
    // and capability-scoped preview assets preserve their existing behavior.
    expect(
      blockOpaqueOriginApplicationRequest(request("/file-preview/content/token/index.html", "null"), {
        websocketRouteMatched: false,
      }),
    ).toBeNull();
    expect(
      blockOpaqueOriginApplicationRequest(request("/api/settings", "http://localhost:5174"), {
        websocketRouteMatched: false,
      }),
    ).toBeNull();
    expect(blockOpaqueOriginApplicationRequest(request("/ws/cli/session"), { websocketRouteMatched: true })).toBeNull();
  });
});
