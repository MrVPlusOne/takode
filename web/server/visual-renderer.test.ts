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

  it("finds fixed colours that don't suit the theme, and none in kit shapes", async () => {
    // A hand-styled pastel box glares on the dark theme, and fixed dark text (here also in
    // SVG) nearly vanishes on it. The same content in kit shapes follows either theme.
    const fixed =
      'alt: x\n---\n<div style="background:#f1f5f9;color:#0f172a">Lint</div>' +
      '<div style="background:color-mix(in srgb, #dcfce7 90%, transparent)">All pass</div>' +
      '<p style="color:#0f172a">dark text</p><svg viewBox="0 0 100 20"><text x="0" y="14" fill="#1e1b4b">svg text</text></svg>';
    const dark = await renderer.render({ source: fixed, width: 400, theme: "dark" });
    expect(dark.brightBoxes?.count).toBe(2);
    expect(dark.brightBoxes?.example).toBe('#f1f5f9 behind "Lint"');
    // Faint: the pastel box's theme-coloured (light) text, and both fixed dark texts.
    expect(dark.faintText?.count).toBe(3);
    expect(dark.faintText?.example).toMatch(/^#eeeeee on #[0-9a-f]{6} in "All pass"$/);
    // The light theme has no glare to report, and that dark text reads fine on it.
    const light = await renderer.render({ source: fixed, width: 400, theme: "light" });
    expect(light.brightBoxes?.count).toBe(0);
    expect(light.faintText?.count).toBe(0);

    const kit =
      'alt: x\n---\n<div class="tk-flow tk-down"><div class="tk-steps"><div class="tk-step"><b>Lint</b> <code>coqchk</code></div></div>' +
      '<div class="tk-grid"><div class="tk-box" data-tone="good">All pass</div><div class="tk-box" data-tone="warn">Slow</div></div></div>';
    for (const theme of ["dark", "light"] as const) {
      const result = await renderer.render({ source: kit, width: 400, theme });
      expect([result.brightBoxes?.count, result.faintText?.count]).toEqual([0, 0]);
    }
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
