// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("mobile animation stability", () => {
  it("disables opacity entrance animations on scroll-critical mobile surfaces", async () => {
    const css = await readFile(new URL("../index.css", import.meta.url), "utf8");

    expect(css).toContain("@media (hover: none) and (pointer: coarse)");
    expect(css).toContain(".mobile-scroll-stable-surface .animate-\\[fadeSlideIn_0\\.2s_ease-out\\]");
    expect(css).toContain(".mobile-scroll-stable-surface .thread-tab-pop");
    expect(css).toContain("animation: none !important;");
  });
});
