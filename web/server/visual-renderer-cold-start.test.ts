import { afterAll, describe, expect, it, vi } from "vitest";

// A cold Chrome start can take seconds on a busy machine (as on CI runners). Here the start is
// slowed by delaying the creation of Chrome's profile folder, which happens before Chrome is spawned,
// so Chrome itself starts normally afterwards.
const slowStart = vi.hoisted(() => ({ delayMs: 0 }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdtemp: (async (prefix: string) => {
      if (prefix.includes("takode-visual-chrome-"))
        await new Promise((resolve) => setTimeout(resolve, slowStart.delayMs));
      return actual.mkdtemp(prefix);
    }) as typeof actual.mkdtemp,
  };
});

const { findChrome, VisualRenderer } = await import("./visual-renderer.js");
const chrome = await findChrome().catch(() => null);

describe.skipIf(!chrome)("VisualRenderer cold start", () => {
  const settleBudgetMs = 2500;
  const renderer = new VisualRenderer({ assetBase: "http://127.0.0.1:9", settleBudgetMs, memoryLimitMb: 1200 });
  afterAll(() => renderer.close());

  // The start alone outlasts a render's whole limit (its settle budget plus 8 s of slack), yet the
  // visual itself is fine, so it must render instead of being reported (and cached) as a timeout.
  it("does not count Chrome's start against the first visual's time limit", async () => {
    slowStart.delayMs = settleBudgetMs + 8000 + 500;
    const result = await renderer.render({
      source: 'alt: One box.\n---\n<div class="tk-box">A</div>',
      width: 400,
      theme: "dark",
      snapshot: true,
    });
    expect(result.status).toBe("ok");
    expect(result.snapshotHtml).toContain("tk-box");
  }, 45_000);
});
