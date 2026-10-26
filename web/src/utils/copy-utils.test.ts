// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  copyRichText,
  getMessageMarkdown,
  getMessagePlainText,
  installPortableSelectionCopy,
  writeClipboardImage,
} from "./copy-utils.js";
import type { ChatMessage } from "../types.js";

function makeMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "test-msg",
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("getMessageMarkdown", () => {
  it("joins text content blocks with double newlines", () => {
    const msg = makeMessage({
      contentBlocks: [
        { type: "text", text: "First paragraph" } as any,
        { type: "text", text: "Second paragraph" } as any,
      ],
    });
    expect(getMessageMarkdown(msg)).toBe("First paragraph\n\nSecond paragraph");
  });

  it("filters out non-text content blocks (tool_use, thinking)", () => {
    const msg = makeMessage({
      contentBlocks: [
        { type: "thinking", thinking: "internal thought" } as any,
        { type: "text", text: "Visible text" } as any,
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } } as any,
      ],
    });
    expect(getMessageMarkdown(msg)).toBe("Visible text");
  });

  it("falls back to message.content when no content blocks", () => {
    const msg = makeMessage({ content: "Fallback content", contentBlocks: undefined });
    expect(getMessageMarkdown(msg)).toBe("Fallback content");
  });

  it("falls back to message.content when content blocks are empty", () => {
    const msg = makeMessage({ content: "Fallback content", contentBlocks: [] });
    expect(getMessageMarkdown(msg)).toBe("Fallback content");
  });

  it("falls back to message.content when no text blocks exist", () => {
    const msg = makeMessage({
      content: "Fallback content",
      contentBlocks: [{ type: "tool_use", id: "t1", name: "Read", input: {} } as any],
    });
    expect(getMessageMarkdown(msg)).toBe("Fallback content");
  });
});

describe("getMessagePlainText", () => {
  it("strips heading markers", () => {
    const msg = makeMessage({
      contentBlocks: [{ type: "text", text: "## Heading\n\nParagraph" } as any],
    });
    expect(getMessagePlainText(msg)).toContain("Heading");
    expect(getMessagePlainText(msg)).not.toContain("##");
  });

  it("strips bold and italic markers", () => {
    const msg = makeMessage({
      contentBlocks: [{ type: "text", text: "This is **bold** and *italic*" } as any],
    });
    const result = getMessagePlainText(msg);
    expect(result).toBe("This is bold and italic");
  });

  it("converts links to just their text", () => {
    const msg = makeMessage({
      contentBlocks: [{ type: "text", text: "Click [here](https://example.com) for more" } as any],
    });
    expect(getMessagePlainText(msg)).toBe("Click here for more");
  });

  it("strips fenced code block markers but keeps content", () => {
    const msg = makeMessage({
      contentBlocks: [{ type: "text", text: "```typescript\nconst x = 1;\n```" } as any],
    });
    const result = getMessagePlainText(msg);
    expect(result).toContain("const x = 1;");
    expect(result).not.toContain("```");
  });

  it("strips inline code backticks", () => {
    const msg = makeMessage({
      contentBlocks: [{ type: "text", text: "Use `npm install` to install" } as any],
    });
    expect(getMessagePlainText(msg)).toBe("Use npm install to install");
  });

  it("strips blockquote markers", () => {
    const msg = makeMessage({
      contentBlocks: [{ type: "text", text: "> This is a quote" } as any],
    });
    expect(getMessagePlainText(msg)).toBe("This is a quote");
  });

  it("strips list markers", () => {
    const msg = makeMessage({
      contentBlocks: [{ type: "text", text: "- Item one\n- Item two\n1. Ordered" } as any],
    });
    const result = getMessagePlainText(msg);
    expect(result).toContain("Item one");
    expect(result).toContain("Item two");
    expect(result).toContain("Ordered");
    expect(result).not.toMatch(/^- /m);
    expect(result).not.toMatch(/^1\. /m);
  });

  it("preserves exact TeX source while stripping surrounding Markdown", () => {
    // Emphasis stripping must not remove `_` or `*` operators from formulas in
    // full-message Plain Text copy.
    const msg = makeMessage({
      contentBlocks: [
        {
          type: "text",
          text: String.raw`**Math:** $x_i + a*b*c$ and \(y_{n}\).

$$
\frac{s-1}{6}
$$`,
        } as any,
      ],
    });

    expect(getMessagePlainText(msg)).toBe(String.raw`Math: $x_i + a*b*c$ and \(y_{n}\).

$$
\frac{s-1}{6}
$$`);
  });

  it("preserves genuine private-use and placeholder-looking source", () => {
    const source = "\uE0000\uE001 \0M0; " + String.raw`**Math:** \(x_i\)`;
    const msg = makeMessage({ content: source });

    expect(getMessagePlainText(msg)).toBe("\uE0000\uE001 \0M0; " + String.raw`Math: \(x_i\)`);
  });

  it("does not mistake ordinary currency for a protected formula", () => {
    const msg = makeMessage({ content: "Prices are $5 and $10 today." });
    expect(getMessagePlainText(msg)).toBe("Prices are $5 and $10 today.");
  });
});

describe("copyRichText", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses ClipboardItem API when available", async () => {
    const mockWrite = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { write: mockWrite, writeText: vi.fn() } });
    // Ensure ClipboardItem is defined
    if (typeof globalThis.ClipboardItem === "undefined") {
      (globalThis as any).ClipboardItem = class {
        constructor(public items: Record<string, Blob>) {}
      };
    }

    await copyRichText("<b>Hello</b>", "Hello");

    expect(mockWrite).toHaveBeenCalledTimes(1);
    const item = mockWrite.mock.calls[0][0][0];
    expect(item.items["text/html"]).toBeInstanceOf(Blob);
    expect(item.items["text/plain"]).toBeInstanceOf(Blob);
  });

  it("falls back to writeText when ClipboardItem is undefined", async () => {
    const origClipboardItem = globalThis.ClipboardItem;
    (globalThis as any).ClipboardItem = undefined;
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { write: vi.fn(), writeText: mockWriteText } });

    await copyRichText("<b>Hello</b>", "Hello");

    expect(mockWriteText).toHaveBeenCalledWith("Hello");
    // Restore
    (globalThis as any).ClipboardItem = origClipboardItem;
  });
});

describe("installPortableSelectionCopy", () => {
  // The browser's own copy turns every rendered link into an absolute URL, so a `#98723` session
  // reference reached Slack as a link to http://localhost:3456/#. The listener rewrites only selections
  // touching such internal links and leaves every other copy to the browser.
  let uninstall: () => void;
  beforeEach(() => {
    uninstall = installPortableSelectionCopy();
  });
  afterEach(() => {
    uninstall();
    document.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
  });

  function copySelectionOf(
    html: string,
    select: (root: HTMLElement, range: Range) => void = (root, range) => range.selectNodeContents(root),
  ): {
    event: Event;
    data: Map<string, string>;
  } {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.replaceChildren(root);
    const range = document.createRange();
    select(root, range);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);

    const data = new Map<string, string>();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        setData: (type: string, value: string) => data.set(type, value),
      },
    });
    root.dispatchEvent(event);
    return { event, data };
  }

  it("copies internal links as their text and keeps outside links", () => {
    const { event, data } = copySelectionOf(
      '<p>Already on the branch: <a href="#">#98723</a> (commit check), see <a href="https://example.com/pr">the PR</a></p>',
    );
    expect(event.defaultPrevented).toBe(true);
    expect(data.get("text/html")).toBe(
      '<p>Already on the branch: #98723 (commit check), see <a href="https://example.com/pr">the PR</a></p>',
    );
    expect(data.get("text/plain")).toBe("Already on the branch: #98723 (commit check), see the PR");
  });

  // Selecting table rows on a phone copied them without tab separators, so Slack pasted messy text
  // instead of its own table; desktop browsers already copy tab-separated cells.
  const TABLE = "<table><tr><th>Domain</th><th>Share</th></tr><tr><td>SWE</td><td>15.5%</td></tr></table>";

  it("copies a selection within one table as tab-separated cells, keeping the HTML table", () => {
    const { event, data } = copySelectionOf(`<p>Intro</p>${TABLE}`, (root, range) =>
      range.selectNodeContents(root.querySelector("table")!),
    );
    expect(event.defaultPrevented).toBe(true);
    expect(data.get("text/plain")).toBe("Domain\tShare\nSWE\t15.5%");
    expect(data.get("text/html")).toContain("<td>15.5%</td>");
  });

  it("leaves words selected inside one cell, and selections reaching outside the table, to the browser", () => {
    const inCell = copySelectionOf(TABLE, (root, range) => range.selectNodeContents(root.querySelector("td")!));
    expect(inCell.event.defaultPrevented).toBe(false);
    const mixed = copySelectionOf(`<p>Intro</p>${TABLE}`);
    expect(mixed.event.defaultPrevented).toBe(false);
  });

  it("leaves selections without internal links to the browser", () => {
    const { event, data } = copySelectionOf('<p>see <a href="https://example.com/pr">the PR</a></p>');
    expect(event.defaultPrevented).toBe(false);
    expect(data.size).toBe(0);
  });
});

describe("writeClipboardImage", () => {
  // Captures what the copy put on the clipboard: one item, keyed by MIME type, whose value is a promise.
  class FakeClipboardItem {
    constructor(readonly items: Record<string, Promise<Blob>>) {}
  }
  let written: FakeClipboardItem[] = [];
  const write = vi.fn(async (items: FakeClipboardItem[]) => {
    written = items;
  });

  beforeEach(() => {
    written = [];
    write.mockClear();
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    Object.defineProperty(navigator, "clipboard", {
      value: { write },
      configurable: true,
    });
  });

  // jsdom lacks some of these properties, so they are set directly and put back after each test.
  let restoreProperties: (() => void)[] = [];
  function stubProperty<T extends object>(target: T, key: string, value: unknown) {
    const original = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { value, configurable: true, writable: true });
    restoreProperties.push(() =>
      original ? Object.defineProperty(target, key, original) : delete (target as Record<string, unknown>)[key],
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const restore of restoreProperties.reverse()) restore();
    restoreProperties = [];
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });

  it("starts the clipboard write at once and passes a PNG image through unchanged", async () => {
    let finishFetch: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (finishFetch = resolve))),
    );

    const copied = writeClipboardImage("blob:http://localhost/plot");
    // Safari only accepts a clipboard write begun inside the tap, so it must not wait for the download.
    expect(write).toHaveBeenCalledTimes(1);
    finishFetch(new Response("png-bytes", { headers: { "Content-Type": "image/png" } }));
    await copied;

    expect(Object.keys(written[0]!.items)).toEqual(["image/png"]);
    const blob = await written[0]!.items["image/png"];
    expect(blob.type).toBe("image/png");
    expect(await blob.text()).toBe("png-bytes");
  });

  it("redraws other image types as PNG and frees the canvas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("webp-bytes", { headers: { "Content-Type": "image/webp" } })),
    );
    // jsdom cannot decode images: fake the object URL and a decoded 640x480 <img>.
    const createObjectURL = vi.fn((_blob: Blob) => "blob:http://localhost/fetched");
    const revokeObjectURL = vi.fn();
    stubProperty(URL, "createObjectURL", createObjectURL);
    stubProperty(URL, "revokeObjectURL", revokeObjectURL);
    stubProperty(HTMLImageElement.prototype, "decode", async () => undefined);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(640);
    vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(480);
    const drawImage = vi.fn();
    const canvases: HTMLCanvasElement[] = [];
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = createElement(tag);
      if (tag !== "canvas") return element;
      const canvas = element as HTMLCanvasElement;
      canvases.push(canvas);
      canvas.getContext = (() => ({ drawImage })) as unknown as HTMLCanvasElement["getContext"];
      canvas.toBlob = (callback, type) => {
        expect([canvas.width, canvas.height]).toEqual([640, 480]);
        callback(new Blob(["redrawn"], { type: type ?? "" }));
      };
      return canvas;
    });

    await writeClipboardImage("/api/fs/image?path=%2Ftmp%2Fplot.png&variant=full");
    const blob = await written[0]!.items["image/png"];

    expect(createObjectURL.mock.calls[0]![0].type).toBe("image/webp");
    const drawn = drawImage.mock.calls[0]![0] as HTMLImageElement;
    expect(drawn.src).toBe("blob:http://localhost/fetched");
    expect(blob.type).toBe("image/png");
    expect(await blob.text()).toBe("redrawn");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/fetched");
    expect([canvases[0]!.width, canvases[0]!.height]).toEqual([0, 0]);
  });

  it("fails when the image cannot be fetched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("missing", { status: 404 })),
    );

    await writeClipboardImage("/api/fs/image?path=%2Ftmp%2Fgone.png");

    await expect(written[0]!.items["image/png"]).rejects.toThrow("HTTP 404");
  });
});
