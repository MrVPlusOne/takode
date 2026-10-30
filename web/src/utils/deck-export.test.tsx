// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownContent } from "../components/MarkdownContent.js";
import { exportDeck, withVisualMarkers } from "./deck-export.js";

/**
 * A deck's PDF and web page: one 1280x720 page per slide, with each visual replaced by the
 * picture the server draws of it (pages and PDFs can't run visuals).
 */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const DECK = [
  "---",
  "slides: true",
  "---",
  "",
  "# The deck",
  "",
  "---",
  "",
  "## A flow",
  "",
  "```visual",
  "title: Two steps",
  "alt: Step one, then step two.",
  "---",
  "<div class='tk-flow'></div>",
  "```",
  "",
  "---",
  "",
  "## A failing visual",
  "",
  "```visual",
  "title: Broken",
  "alt: What the broken visual said.",
  "---",
  "<div></div>",
  "```",
].join("\n");

describe("deck exports", () => {
  it("replaces each visual block with a marker paragraph and keeps what it stood for", () => {
    const { markdown, visuals } = withVisualMarkers(DECK);
    expect(markdown).not.toContain("```visual");
    expect(markdown).toContain("## A flow\n\n⟦takode-visual-0⟧\n");
    expect(visuals).toEqual([
      {
        source: "title: Two steps\nalt: Step one, then step two.\n---\n<div class='tk-flow'></div>",
        alt: "Step one, then step two.",
      },
      {
        source: "title: Broken\nalt: What the broken visual said.\n---\n<div></div>",
        alt: "What the broken visual said.",
      },
    ]);
  });

  it("saves a web page of one slide-sized page per slide, visuals as server-drawn pictures", async () => {
    // The first visual draws; the second fails and leaves its description in its place.
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) =>
      String(init?.body).includes("Broken")
        ? { ok: false, status: 503, blob: async () => new Blob() }
        : { ok: true, blob: async () => new Blob(["png-bytes"], { type: "image/png" }) },
    );
    vi.stubGlobal("fetch", fetchMock);
    // Saving hands the file to a download link; keep what it would have downloaded.
    const blobs = new Map<string, Blob>();
    const saved: { blob: Blob; name: string }[] = [];
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL(blob: Blob) {
          blobs.set("blob:deck", blob);
          return "blob:deck";
        }
        static revokeObjectURL() {}
      },
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ blob: blobs.get(this.getAttribute("href")!)!, name: this.download });
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await exportDeck("html", { markdown: DECK, title: "The deck", render: (text) => <MarkdownContent text={text} /> });

    expect(fetchMock).toHaveBeenCalledWith("/api/visuals/image", expect.objectContaining({ method: "POST" }));
    expect(saved[0].name).toBe("the-deck.html");
    const html = await saved[0].blob.text();
    // Three slides, each its own printed page at the stage's size.
    expect(html.match(/<section class="takode-slide-stage takode-export-slide"/g)).toHaveLength(3);
    expect(html).toContain("@page { size: 1280px 720px; margin: 0; }");
    expect(html).toContain(
      '<img class="takode-export-visual" alt="Step one, then step two." src="data:image/png;base64,',
    );
    expect(html).toContain('<p class="takode-export-visual-alt">What the broken visual said.</p>');
    expect(html).not.toContain("slides: true");
    expect(html).not.toContain("⟦takode-visual");
    // Nothing is left behind in the page that made it.
    expect(document.body.querySelector("[aria-hidden]")).toBeNull();
  });
});
