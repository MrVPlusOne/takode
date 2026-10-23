import { afterAll, describe, expect, it } from "vitest";
import { findChrome, VisualRenderer } from "./visual-renderer.js";

// These drive a real headless Chrome; machines without one skip them.
const chrome = await findChrome().catch(() => null);

describe.skipIf(!chrome)("VisualRenderer with a real Chrome", () => {
  // No helper libraries are needed: the visuals below use the kit or plain scripts.
  const renderer = new VisualRenderer({ assetBase: "http://127.0.0.1:9", settleBudgetMs: 2500, memoryLimitMb: 1200 });
  afterAll(() => renderer.close());

  it("draws a kit visual and returns its script-free snapshot", async () => {
    const result = await renderer.render({
      source:
        'alt: Two boxes.\n---\n<div class="tk-flow"><div class="tk-box">A</div><div class="tk-box">B</div></div><script>document.body.dataset.ran = "1"</script>',
      width: 400,
      theme: "dark",
      snapshot: true,
    });
    expect(result.status).toBe("ok");
    expect(result.elementCount).toBeGreaterThanOrEqual(3);
    expect(result.contentWidth).toBeLessThanOrEqual(402);
    // The snapshot is what the script left behind, without the script.
    expect(result.snapshotHtml).toContain("tk-box");
    expect(result.snapshotHtml).not.toContain("<script");
  }, 30_000);

  it("reports an endless loop as a timeout and keeps rendering afterwards", async () => {
    const looping = await renderer.render({ source: "<script>while (true) {}</script>", width: 400, theme: "dark" });
    expect(looping.status).toBe("timeout");
    // A stuck page must not hold the queue: the next visual renders normally.
    const next = await renderer.render({ source: "<p>after</p>", width: 400, theme: "light", snapshot: true });
    expect(next.status).toBe("ok");
  }, 60_000);

  it("stops a visual that eats memory and reports it as crashed", async () => {
    const result = await renderer.render({
      source:
        '<p id="m"></p><script>const keep=[];(function grow(){for(let i=0;i<40;i++)keep.push(new Float64Array(4e6).fill(i));setTimeout(grow,0)})()</script>',
      width: 400,
      theme: "dark",
      snapshot: true,
    });
    // Either the memory cap or Chrome itself ends it; it is never shown.
    expect(["crashed", "timeout"]).toContain(result.status);
  }, 60_000);
});
