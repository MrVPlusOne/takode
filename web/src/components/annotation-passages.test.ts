// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  annotationPassageRects,
  mergePassageRects,
  captureAnnotationSource,
  resolveAnnotationRange,
} from "./annotation-passages.js";
import { readConversationAnnotations, formatAnnotatedMessage } from "../../shared/conversation-annotations.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function source() {
  document.body.innerHTML =
    '<div data-message-id="source"><div data-chat-selection-scope="true">Same <b>phrase</b>. Same <a href="#link">phrase</a>.</div><div data-chat-selection-scope="true">Another scope.</div></div>';
  return document.body.firstElementChild as HTMLElement;
}

describe("annotation passage identity", () => {
  it("retains the selected repeated occurrence across storage and remount without changing text or agent formatting", () => {
    // A literal search alone cannot distinguish the two identical phrases in this rendered message.
    const root = source();
    const range = document.createRange();
    range.selectNodeContents(root.querySelector("a")!);
    const selected = {
      id: "comment",
      selectedText: "phrase",
      comment: "Explain the second occurrence.",
      ...captureAnnotationSource(range),
    };
    const [stored] = readConversationAnnotations(JSON.parse(JSON.stringify([selected])));
    const remounted = source();
    const resolved = resolveAnnotationRange(remounted, stored)!;
    expect(resolved.startContainer.parentElement?.tagName).toBe("A");
    expect(resolved.toString()).toBe("phrase");
    expect(formatAnnotatedMessage("", [stored])).toBe("> phrase\n[comment 1] Explain the second occurrence.");
    expect(remounted.querySelector("a")?.getAttribute("href")).toBe("#link");
  });

  it("anchors a whole scope spanning formatted inline nodes", () => {
    const root = source();
    const scope = root.querySelector("[data-chat-selection-scope]")!;
    const range = document.createRange();
    range.selectNodeContents(scope);
    const annotation = {
      id: "whole",
      selectedText: range.toString(),
      comment: "Whole paragraph",
      ...captureAnnotationSource(range),
    };
    expect(resolveAnnotationRange(root, annotation)?.toString()).toBe(scope.textContent);
  });

  it("does not retarget changed anchored text or guess among repeated legacy quotations", () => {
    const root = source();
    const legacy = { id: "legacy", selectedText: "phrase", comment: "Which one?" };
    expect(resolveAnnotationRange(root, legacy)).toBeNull();
    const range = document.createRange();
    range.selectNodeContents(root.querySelector("a")!);
    const anchored = { ...legacy, ...captureAnnotationSource(range) };
    root.querySelector("a")!.textContent = "changed";
    expect(resolveAnnotationRange(root, anchored)).toBeNull();
    expect(resolveAnnotationRange(root, legacy)?.startContainer.parentElement?.tagName).toBe("B");
  });

  it("rejects malformed source offsets while preserving old annotations without anchors", () => {
    const legacy = { id: "legacy", selectedText: "text", comment: "comment" };
    expect(readConversationAnnotations([legacy])).toEqual([legacy]);
    expect(() =>
      readConversationAnnotations([{ ...legacy, sourceAnchor: { scopeIndex: 0, start: 1, end: 8, text: "text" } }]),
    ).toThrow("Invalid annotation source anchor");
  });
});

describe("annotation passage geometry", () => {
  it("joins overlapping formatted fragments on a line without filling separate lines or columns", () => {
    // Bold descendants and their inline parents can report duplicate, slightly different rectangles.
    expect(
      mergePassageRects([
        { left: 10, top: 20, width: 40, height: 18 },
        { left: 50, top: 19.9, width: 30, height: 18.1 },
        { left: 50.02, top: 20, width: 29.98, height: 18 },
        { left: 80.1, top: 20, width: 40, height: 18 },
        { left: 200, top: 20, width: 30, height: 18 },
        { left: 10, top: 48, width: 60, height: 18 },
      ]),
    ).toEqual([
      { left: 10, top: 19.9, width: 110.1, height: 18.1 },
      { left: 200, top: 19.9, width: 30, height: 18.1 },
      { left: 10, top: 48, width: 60, height: 18 },
    ]);
  });

  it("measures text-node slices rather than ancestor block rectangles", () => {
    document.body.innerHTML = "<p><span>Alpha </span><strong>bold</strong><em> words</em></p>";
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      writable: true,
      value() {
        return [];
      },
    });
    vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (this: Range) {
      const parent = this.startContainer.parentElement?.tagName;
      const left = parent === "SPAN" ? 0 : parent === "STRONG" ? 30 : 60;
      return [
        this.startContainer.nodeType === Node.TEXT_NODE ? new DOMRect(left, 10, 30, 18) : new DOMRect(0, 0, 400, 80),
      ] as unknown as DOMRectList;
    });
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("p")!);
    const original = document.body.innerHTML;
    expect(annotationPassageRects(range)).toEqual([{ left: 0, top: 10, width: 90, height: 18 }]);
    expect(document.body.innerHTML).toBe(original);
    expect(range.toString()).toBe("Alpha bold words");
  });
});
