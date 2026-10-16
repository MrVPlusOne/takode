// @vitest-environment jsdom
//
// Copied Takode content goes to other apps (Slack, docs, mail), where only links leading outside Takode
// work. These tests pin which links a copy keeps and which it reduces to their text.

import { describe, it, expect } from "vitest";
import { portableLinkHref, rangeTouchesNonPortableLink, toPortableHtml } from "./portable-links.js";

describe("portableLinkHref", () => {
  it("keeps outside web and mail links, made absolute", () => {
    expect(portableLinkHref("https://github.com/org/repo/pull/98723")).toBe("https://github.com/org/repo/pull/98723");
    expect(portableLinkHref("mailto:someone@example.com")).toBe("mailto:someone@example.com");
    expect(portableLinkHref("//example.com/page")).toBe("http://example.com/page");
  });

  it("drops links that only lead back into this Takode server or to nowhere", () => {
    // The reported bug: an unresolved `#98723` session reference rendered with a placeholder `#` href.
    expect(portableLinkHref("#")).toBeNull();
    // Session and quest routes are hash URLs on the app's own origin.
    expect(portableLinkHref("#/session/12")).toBeNull();
    expect(portableLinkHref(`${window.location.origin}/#/session/12`)).toBeNull();
    // File previews are served by this server; file: and app-specific schemes are meaningless elsewhere.
    expect(portableLinkHref("/file-preview/notes.html")).toBeNull();
    expect(portableLinkHref("file:/home/me/notes.md")).toBeNull();
    expect(portableLinkHref("quest:q-42")).toBeNull();
    expect(portableLinkHref(null)).toBeNull();
  });
});

describe("toPortableHtml", () => {
  it("reduces internal links to their text and keeps outside links", () => {
    const html = toPortableHtml(
      'Already on the branch: <a href="#">#98723</a>, <a href="#/session/12"><strong>#12</strong></a> and ' +
        '<a href="https://github.com/org/repo/pull/1">PR 1</a>',
    );
    expect(html).toBe(
      'Already on the branch: #98723, <strong>#12</strong> and <a href="https://github.com/org/repo/pull/1">PR 1</a>',
    );
  });

  it("treats anchors without an href as text", () => {
    expect(toPortableHtml("<a>#98723</a> done")).toBe("#98723 done");
  });
});

describe("rangeTouchesNonPortableLink", () => {
  function rangeOver(html: string, select: (root: HTMLElement, range: Range) => void): Range {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.replaceChildren(root);
    const range = document.createRange();
    select(root, range);
    return range;
  }

  it("detects internal links inside the selection and links the selection sits within", () => {
    // Links inside the selection are cloned with it.
    expect(
      rangeTouchesNonPortableLink(rangeOver('see <a href="#">#98723</a>', (root, r) => r.selectNodeContents(root))),
    ).toBe(true);
    // A selection entirely inside a link clones only text, but the browser's copy would still wrap it in the link.
    expect(
      rangeTouchesNonPortableLink(
        rangeOver('see <a href="#/session/12">#12</a>', (root, r) => r.selectNodeContents(root.querySelector("a")!)),
      ),
    ).toBe(true);
  });

  it("ignores selections with only outside links", () => {
    expect(
      rangeTouchesNonPortableLink(
        rangeOver('see <a href="https://example.com">example</a>', (root, r) => r.selectNodeContents(root)),
      ),
    ).toBe(false);
  });
});
