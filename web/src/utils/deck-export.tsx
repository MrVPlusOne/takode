import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import { scanFences } from "../../shared/draft-posts.js";
import { splitSlides } from "../../shared/slides.js";
import { parseVisualBlock } from "../../shared/visual-block.js";
import { isTitleSlide, STAGE_HEIGHT, STAGE_WIDTH } from "../components/slides/SlideDeck.js";
import { exportFileName, renderDocument, saveFile, standalonePage, type ExportFormat } from "./artifact-export.js";

/**
 * Exports of a slide deck: its Markdown as written, or a page of slides (one per printed page in
 * the PDF), each laid out on the 1280x720 stage the deck shows on wide screens. Visuals are drawn
 * by the server as pictures, since a page or PDF can't run them.
 */

export type DeckExportFormat = Extract<ExportFormat, "markdown" | "pdf" | "html">;

/** Saves the deck in `format`; `render` draws a slide's Markdown as the deck does on screen. */
export async function exportDeck(
  format: DeckExportFormat,
  { markdown, title, render }: { markdown: string; title: string; render: (markdown: string) => ReactNode },
): Promise<void> {
  const name = exportFileName(title);
  if (format === "markdown") {
    saveFile(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), `${name}.md`);
    return;
  }
  const html = await deckHtml(markdown, title, render);
  if (format === "html") {
    saveFile(new Blob([html], { type: "text/html;charset=utf-8" }), `${name}.html`);
    return;
  }
  saveFile(await renderDocument(html, "pdf", STAGE_WIDTH), `${name}.pdf`);
}

/** A placeholder for the `n`th visual: a paragraph of its own, replaced by its picture once rendered. */
const visualMarker = (n: number) => `⟦takode-visual-${n}⟧`;

/**
 * The deck's Markdown with every ```visual block replaced by a marker paragraph, and what each
 * marker stands for: the visual's source and its alt text.
 */
export function withVisualMarkers(markdown: string): { markdown: string; visuals: { source: string; alt: string }[] } {
  const visuals: { source: string; alt: string }[] = [];
  let text = "";
  let last = 0;
  for (const fence of scanFences(markdown).fences) {
    if (fence.language !== "visual") continue;
    text += `${markdown.slice(last, fence.start)}${visualMarker(visuals.length)}`;
    const block = parseVisualBlock(fence.body);
    visuals.push({ source: fence.body, alt: block.alt ?? block.title ?? "Visual" });
    last = fence.end;
  }
  return { markdown: text + markdown.slice(last), visuals };
}

async function deckHtml(markdown: string, title: string, render: (markdown: string) => ReactNode): Promise<string> {
  const marked = withVisualMarkers(markdown);
  const pictures = await Promise.all(marked.visuals.map((visual) => visualPicture(visual.source)));
  const slides = splitSlides(marked.markdown);

  // Drawn with the deck's own Markdown rendering, off screen, then copied: the copy is plain DOM
  // that can be changed and measured freely once React lets go of the original.
  const host = offscreen();
  const root = createRoot(host);
  flushSync(() =>
    root.render(
      <div className="takode-export-deck">
        {slides.map((slide, index) => (
          <section key={index} className="takode-slide-stage takode-export-slide">
            <div className="takode-export-slide-box">
              <div className={`takode-export-slide-content ${isTitleSlide(slide.markdown) ? "my-auto" : ""}`}>
                {render(slide.markdown)}
              </div>
            </div>
          </section>
        ))}
      </div>,
    ),
  );
  const deck = host.firstElementChild!.cloneNode(true) as HTMLElement;
  root.unmount();
  // The slides' own layout, so measuring sees the page sizes the export prints.
  const styles = document.createElement("style");
  styles.textContent = SLIDE_STYLES;
  host.replaceChildren(styles, deck);
  try {
    await placePictures(deck, marked.visuals, pictures);
    fitSlides(deck);
    return await standalonePage(deck, title, DECK_STYLES);
  } finally {
    host.remove();
  }
}

/** A visual drawn by the server in the light theme, as a data URL; null when it can't be drawn. */
async function visualPicture(source: string): Promise<string | null> {
  try {
    const response = await fetch("/api/visuals/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, theme: "light" }),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn("[deck-export] A visual could not be drawn; its description is used instead.", error);
    return null;
  }
}

/** Replaces each visual's marker paragraph with its picture, or its description when it has none. */
async function placePictures(
  deck: HTMLElement,
  visuals: { alt: string }[],
  pictures: (string | null)[],
): Promise<void> {
  const loads: Promise<void>[] = [];
  for (const paragraph of Array.from(deck.querySelectorAll("p"))) {
    const match = /^⟦takode-visual-(\d+)⟧$/.exec(paragraph.textContent?.trim() ?? "");
    const visual = match ? visuals[Number(match[1])] : undefined;
    if (!match || !visual) continue;
    const picture = pictures[Number(match[1])];
    if (!picture) {
      const note = document.createElement("p");
      note.className = "takode-export-visual-alt";
      note.textContent = visual.alt;
      paragraph.replaceWith(note);
      continue;
    }
    const image = document.createElement("img");
    image.className = "takode-export-visual";
    image.alt = visual.alt;
    image.src = picture;
    paragraph.replaceWith(image);
    loads.push(Promise.resolve(image.decode?.()).catch(() => {}));
  }
  await Promise.all(loads);
}

/** Shrinks each slide's content to fit its page: a printed slide can't scroll. */
function fitSlides(deck: HTMLElement): void {
  for (const box of Array.from(deck.querySelectorAll<HTMLElement>(".takode-export-slide-box"))) {
    const content = box.firstElementChild as HTMLElement | null;
    if (!content) continue;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const available = box.clientHeight;
      const needed = content.getBoundingClientRect().height;
      if (!available || needed <= available + 1) break;
      const zoom = Number(content.style.zoom || 1);
      content.style.zoom = String((zoom * available) / needed);
    }
  }
}

function offscreen(): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  // Laid out at the stage's size so measurements match the printed page; out of sight and light.
  host.style.cssText = `position:fixed;left:-${STAGE_WIDTH * 3}px;top:0;width:${STAGE_WIDTH}px;pointer-events:none;`;
  document.body.appendChild(host);
  return host;
}

/** The slides' layout, scoped to the deck so it can also lay out the copy measured inside Takode. */
const SLIDE_STYLES = `
.takode-export-deck .takode-export-slide {
  box-sizing: border-box; width: ${STAGE_WIDTH}px; height: ${STAGE_HEIGHT}px; margin: 0 auto 24px;
  padding: 52px 72px; overflow: hidden; background: var(--color-cc-bg); display: flex; flex-direction: column;
  break-after: page; page-break-after: always;
}
.takode-export-deck .takode-export-slide-box { flex: 1; min-height: 0; display: flex; flex-direction: column; }
/* A fixed width rather than 100%, so the picture shrinks with the rest of a slide fitted to its page. */
.takode-export-deck .takode-export-visual { display: block; width: ${STAGE_WIDTH - 144}px; height: auto; margin: 0.4em 0; }
.takode-export-deck .takode-export-visual-alt { font-style: italic; color: var(--color-cc-muted); }
.takode-export-deck pre, .takode-export-deck pre code { white-space: pre-wrap !important; overflow-wrap: anywhere; }
.takode-export-deck pre, .takode-export-deck .overflow-x-auto { overflow-x: visible !important; }
`;

/** The page around the slides: one slide per printed page, a grey desk behind them on screen. */
const DECK_STYLES = `${SLIDE_STYLES}
@page { size: ${STAGE_WIDTH}px ${STAGE_HEIGHT}px; margin: 0; }
html, body { background: #e9e7e1; color-scheme: light; margin: 0; }
.takode-export { padding: 24px 0; }
@media print {
  html, body { background: none; }
  .takode-export { padding: 0; }
  .takode-export-deck .takode-export-slide { margin: 0; }
}
`;
