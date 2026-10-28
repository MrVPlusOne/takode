// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportFileName, standaloneHtml } from "./artifact-export.js";

/**
 * The web page an export is made from: the card's Markdown body as shown, standing alone (images
 * inlined), in the light theme, without the card's controls or comment overlays.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("standalone export page", () => {
  it("keeps the Markdown body, inlines its images and leaves controls and overlays out", async () => {
    // jsdom reads only its own Blob, so the response hands one over.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, blob: async () => new Blob(["png-bytes"], { type: "image/png" }) })),
    );
    document.body.innerHTML = `
      <div id="card">
        <div class="markdown-body"><h1>Report</h1><p>Body <img src="/api/fs/image?path=/tmp/a.png"></p>
          <button>Copy</button><span data-copy-exclude="">Copy for Slack</span>
          <iframe data-live="" srcdoc="<p>live</p>"></iframe>
          <iframe data-still="" srcdoc='<!doctype html><html class="dark"><body>still</body></html>'></iframe>
        </div>
        <div data-annotation-overlay="">highlight</div>
      </div>`;
    const html = await standaloneHtml(document.getElementById("card")!, 'A <b> "title"');

    expect(html).toContain("<title>A &lt;b&gt; &quot;title&quot;</title>");
    expect(html).toContain("<h1>Report</h1>");
    expect(html).toContain('src="data:image/png;base64,');
    for (const left of ["Copy for Slack", "<button", "highlight", "live"]) expect(html).not.toContain(left);
    // A visual's still picture stays, drawn light like the rest of the page.
    expect(html).toContain("still");
    expect(html).not.toContain('class="dark"');
  });

  it("names files from titles", () => {
    expect(exportFileName("Why SD@400 scores lower on T7's 384K evals")).toBe(
      "why-sd-400-scores-lower-on-t7-s-384k-evals",
    );
    expect(exportFileName("devbox-first-time-setup.md")).toBe("devbox-first-time-setup");
    expect(exportFileName("???")).toBe("export");
  });
});
