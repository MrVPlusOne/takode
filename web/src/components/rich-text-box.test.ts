// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { domPointAt, escapeHtml, installTextBoxApi, readText, reconcile, type LineRenderer } from "./rich-text-box.js";
import { markdownLines } from "./rich-text-markdown.js";

// The rich-text box keeps a plain string as its value and draws it one <div> per line. These
// tests pin the three things everything else relies on: reading the text back from whatever DOM
// the browser left, mapping caret points to text offsets and back, and redrawing only lines that
// no longer match (so the browser's own edits, caret and IME state are left alone).

// The simplest drawing: each line's text as is, so reconcile's own behaviour is what's tested.
const plainLines: LineRenderer = (lines) =>
  lines.map((line) => ({ className: "rt-line", html: line ? escapeHtml(line) : "<br>" }));

function box(html: string): HTMLDivElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

describe("readText", () => {
  it("reads lines, empty lines held by a <br>, and line breaks inside a line", () => {
    expect(readText(box("<div>a</div><div><br></div><div>b</div>")).text).toBe("a\n\nb");
    expect(readText(box("<div>a<br>b</div>")).text).toBe("a\nb");
    // A last <br> in a block only gives the line its height.
    expect(readText(box("<div>a<br></div><div>b</div>")).text).toBe("a\nb");
  });

  it("reads the shapes browsers leave after their own edits", () => {
    // Text typed straight into an emptied box, before and after a line.
    expect(readText(box("x<div>a</div>")).text).toBe("x\na");
    expect(readText(box("<div>a</div>x")).text).toBe("a\nx");
    // Styled spans inside a line are just text.
    expect(readText(box('<div>a <span class="md-mark">**</span><span>b</span></div>')).text).toBe("a **b");
  });

  it("maps caret points to text offsets, including the start of an empty line", () => {
    const root = box("<div>ab</div><div><br></div><div>cd</div>");
    const [first, empty, second] = Array.from(root.children);
    const { offsets } = readText(root, [
      { node: first!.firstChild!, offset: 1 },
      { node: empty!, offset: 0 },
      // After the placeholder <br>: still the empty line.
      { node: empty!, offset: 1 },
      { node: second!.firstChild!, offset: 2 },
    ]);
    expect(offsets).toEqual([1, 3, 3, 6]);
  });
});

describe("domPointAt", () => {
  it("is the inverse of readText's offsets on a drawn box", () => {
    const root = box("");
    const text = "Say **hi** now\n\n- item `x`";
    reconcile(root, text, markdownLines);
    for (let index = 0; index <= text.length; index++) {
      const point = domPointAt(root, index);
      expect(readText(root, [point]).offsets[0]).toBe(index);
    }
  });
});

describe("domPointAt after a mark", () => {
  it("puts the caret at the start of the text after the mark, where that text is drawn", () => {
    const root = box("");
    reconcile(root, "> quoted **bold**", markdownLines);
    const afterQuoteMark = domPointAt(root, 2);
    expect(afterQuoteMark.node.textContent).toBe("quoted ");
    expect(afterQuoteMark.offset).toBe(0);
    // A mark at the end of its line has nothing after it, so the caret stays at its end.
    const lineEnd = domPointAt(root, "> quoted **bold**".length);
    expect(lineEnd.node.parentElement?.classList.contains("md-mark")).toBe(true);
  });
});

describe("reconcile", () => {
  it("leaves lines that still match untouched and redraws the rest", () => {
    const root = box("");
    reconcile(root, "one\ntwo", plainLines);
    const [first, second] = Array.from(root.children);
    const firstText = first!.firstChild;
    // The browser typed into the second line; the first must keep its very nodes.
    second!.firstChild!.textContent = "two!";
    expect(reconcile(root, "one\ntwo!", plainLines)).toBe(false);
    expect(root.children[0]!.firstChild).toBe(firstText);
    expect(reconcile(root, "one\ntwo!\nthree", plainLines)).toBe(true);
    expect(readText(root).text).toBe("one\ntwo!\nthree");
  });

  it("normalises stray nodes and merged lines back to one div per line", () => {
    const root = box("<div>a</div>b<span>c</span>");
    reconcile(root, readText(root).text, plainLines);
    expect(root.innerHTML).toBe('<div class="rt-line">a</div><div class="rt-line">bc</div>');
  });
});

describe("markdownLines", () => {
  const draw = (text: string) => markdownLines(text.split("\n"));

  it("keeps every character, so the text reads back unchanged", () => {
    const text =
      "# Title\n**bold** _em_ ~~gone~~ `a*b*`\n- one\n2) two\n> quote\n```\n**not bold**\n```\n[transcribed]";
    const root = box("");
    reconcile(root, text, markdownLines);
    expect(readText(root).text).toBe(text);
  });

  it("styles marks and their text, leaving code and snake_case alone", () => {
    expect(draw("a **b** c")[0]!.html).toBe(
      'a <span class="md-mark">**</span><span class="md-strong">b</span><span class="md-mark">**</span> c',
    );
    expect(draw("`*x*`")[0]!.html).toContain('<span class="md-code-span">*x*</span>');
    expect(draw("snake_case_name")[0]!.html).toBe("snake_case_name");
    expect(draw("a * b * c")[0]!.html).toBe("a * b * c");
  });

  it("highlights quest and session references as the feed links them, except in code", () => {
    expect(draw("See q-12 and **#34**, not `q-12`")[0]!.html).toBe(
      'See <span class="md-ref">q-12</span> and <span class="md-mark">**</span><span class="md-strong"><span class="md-ref">#34</span></span><span class="md-mark">**</span>, not <span class="md-mark">`</span><span class="md-code-span">q-12</span><span class="md-mark">`</span>',
    );
  });

  it("draws a quote's marks in one fixed space per level, so its wrapped lines can hang under them", () => {
    // The marks keep the space of their level whatever their spacing; CSS hangs the line from it.
    expect(draw("> one")[0]).toEqual({
      className: "rt-line md-quote md-quote-1",
      html: '<span class="md-mark md-quote-mark">&gt; </span>one',
    });
    expect(draw("> > two")[0]!.className).toBe("rt-line md-quote md-quote-2");
    expect(draw(">>> three")[0]!.className).toBe("rt-line md-quote md-quote-3");
    expect(draw(">>>> deep")[0]!.className).toBe("rt-line md-quote md-quote-3");
  });

  it("draws list markers, code fences and the transcription label by line", () => {
    const lines = draw("- item\n```\n# not a heading\n```\n[transcribed]");
    expect(lines[0]).toEqual({ className: "rt-line md-item", html: '<span class="md-bullet">-</span> item' });
    expect(lines.map((line) => line.className)).toEqual([
      "rt-line md-item",
      "rt-line md-fence",
      "rt-line md-code",
      "rt-line md-fence",
      "rt-line",
    ]);
    expect(lines[4]!.html).toBe('<span class="md-tag">[transcribed]</span>');
  });
});

describe("installTextBoxApi", () => {
  it("answers the textarea API the composer uses", () => {
    const root = box("");
    const remove = installTextBoxApi(root, () => plainLines);
    const area = root as HTMLDivElement & HTMLTextAreaElement;
    area.value = "hello\nworld";
    expect(root.children).toHaveLength(2);
    // Unfocused, the selection is remembered, as a textarea's is.
    area.setSelectionRange(2, 4);
    expect([area.selectionStart, area.selectionEnd]).toEqual([2, 4]);
    area.setRangeText("XY", 6, 11, "end");
    expect(area.value).toBe("hello\nXY");
    expect(area.selectionStart).toBe(8);
    remove();
    expect("selectionStart" in root).toBe(false);
  });
});
