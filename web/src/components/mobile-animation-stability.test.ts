// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("mobile animation stability", () => {
  it("disables opacity entrance animations on scroll-critical mobile surfaces", async () => {
    const css = await readFile(new URL("../index.css", import.meta.url), "utf8");

    expect(css).toContain("@media (hover: none) and (pointer: coarse)");
    expect(css).toContain(".mobile-scroll-stable-surface .animate-\\[fadeSlideIn_0\\.2s_ease-out\\]");
    // The thread tab pop animation went with the per-tab strip, so nothing else is listed.
    expect(css).not.toContain("thread-tab-pop");
    expect(css).toContain("animation: none !important;");
  });

  it("disables opacity entrance animations throughout the message feed", async () => {
    const css = await readFile(new URL("../index.css", import.meta.url), "utf8");

    expect(css).toContain(".message-feed-scroll-surface .animate-\\[fadeSlideIn_0\\.2s_ease-out\\]");
    expect(css).toMatch(
      /\.message-feed-scroll-surface \.animate-\\\[fadeSlideIn_0\\\.2s_ease-out\\\] \{\s*animation: none !important;/,
    );
  });
});
