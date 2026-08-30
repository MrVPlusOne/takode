import { describe, expect, it } from "vitest";
import { getStaticAssetCacheControl } from "./static-asset-cache.js";

describe("static asset cache headers", () => {
  it("prevents the application entry document from surviving an explicit Reload", () => {
    // A build-mismatch Reload must fetch the new bundle references instead of reusing stale entry HTML.
    expect(getStaticAssetCacheControl("/app/dist/index.html")).toBe("no-store");
    expect(getStaticAssetCacheControl("index.html")).toBe("no-store");
  });

  it("marks versioned leader profile portrait assets as immutable", () => {
    expect(getStaticAssetCacheControl("/app/dist/leader-profile-portraits/tako/tako1-01.v2.96.webp")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(
      getStaticAssetCacheControl("C:\\app\\dist\\leader-profile-portraits\\fallback\\leader-fallback.v2.320.webp"),
    ).toBe("public, max-age=31536000, immutable");
  });

  it("leaves non-versioned or unrelated static assets on default serving behavior", () => {
    expect(getStaticAssetCacheControl("/app/dist/leader-profile-portraits/tako/tako1-01.96.webp")).toBeNull();
    expect(getStaticAssetCacheControl("/app/dist/assets/index.js")).toBeNull();
  });
});
