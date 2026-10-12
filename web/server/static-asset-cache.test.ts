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

  it("lets browsers keep content-hashed build output instead of downloading it on every app open", () => {
    // Vite puts a hash of each file's content in its name, so the same URL always means the same bytes.
    // Without this the phone re-downloaded the whole ~1 MB bundle each time the app opened.
    for (const name of [
      "index-DpYlsYU2.js",
      "index-WYLMAwQn.css",
      "KaTeX_AMS-Regular-BQhdFMY1.woff2",
      "Terminal-a_b-C1d2.js",
    ]) {
      expect(getStaticAssetCacheControl(`/app/dist/assets/${name}`), name).toBe("public, max-age=31536000, immutable");
    }
    expect(getStaticAssetCacheControl("C:\\app\\dist\\assets\\index-DpYlsYU2.js")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("leaves non-versioned or unrelated static assets on default serving behavior", () => {
    expect(getStaticAssetCacheControl("/app/dist/leader-profile-portraits/tako/tako1-01.96.webp")).toBeNull();
    expect(getStaticAssetCacheControl("/app/dist/assets/index.js")).toBeNull();
    // Unhashed names outside the build output can change content in place, so they keep revalidating.
    expect(getStaticAssetCacheControl("/app/dist/manifest.json")).toBeNull();
    expect(getStaticAssetCacheControl("/app/dist/sw.js")).toBeNull();
    expect(getStaticAssetCacheControl("/app/dist/takode-build.json")).toBeNull();
    expect(getStaticAssetCacheControl("/app/dist/icons/logo-DpYlsYU2.png")).toBeNull();
  });
});
