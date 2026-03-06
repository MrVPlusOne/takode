"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_BASE_URL,
  buildPanelHtml,
  getHealthUrl,
  normalizeBaseUrl,
} = require("../src/panel");
const { formatSelectionContext, summarizeText } = require("../src/editor-context");

test("normalizeBaseUrl falls back to the default localhost URL", () => {
  assert.equal(normalizeBaseUrl(""), DEFAULT_BASE_URL + "/");
});

test("normalizeBaseUrl accepts bare localhost hosts for convenience", () => {
  assert.equal(normalizeBaseUrl("127.0.0.1:3456"), "http://localhost:3456/");
});

test("normalizeBaseUrl rejects non-http protocols so the iframe target stays predictable", () => {
  assert.throws(
    () => normalizeBaseUrl("file:///tmp/takode"),
    /Takode URL must use http:\/\/ or https:\/\//,
  );
});

test("getHealthUrl always points at the Takode root health endpoint", () => {
  assert.equal(
    getHealthUrl("http://127.0.0.1:5174/#/session/demo"),
    "http://127.0.0.1:5174/api/health",
  );
});

test("buildPanelHtml embeds the Takode iframe URL and the health probe target", () => {
  const html = buildPanelHtml({
    baseUrl: "http://127.0.0.1:5174/",
    cspSource: "vscode-webview://test",
    nonce: "nonce-123",
  });

  // This keeps the test focused on the prototype behavior: the iframe must
  // load the exact Takode origin, while health checks keep the panel honest
  // when the local server is missing or restarted.
  assert.match(html, /<iframe[\s\S]*id="takode-frame"/);
  assert.match(html, /"http:\/\/127\.0\.0\.1:5174\/"/);
  assert.match(html, /"http:\/\/127\.0\.0\.1:5174\/api\/health"/);
  assert.match(html, /takode:vscode-context/);
  assert.doesNotMatch(html, /selection-label/);
});

test("formatSelectionContext renders an inline cursor label when the selection is empty", () => {
  assert.equal(
    formatSelectionContext({
      pathLabel: "web/src/App.tsx",
      startLine: 42,
      startCharacter: 7,
      isEmpty: true,
      lineText: "const route = useMemo(() => parseHash(hash), [hash]);",
    }),
    "Cursor: web/src/App.tsx:42:7  const route = useMemo(() => parseHash(hash), [hash]);",
  );
});

test("formatSelectionContext renders the selection range and preview text", () => {
  assert.equal(
    formatSelectionContext({
      pathLabel: "web/src/Composer.tsx",
      startLine: 12,
      startCharacter: 3,
      endLine: 14,
      endCharacter: 9,
      isEmpty: false,
      selectedText: "selected\ntext",
    }),
    "Selection: web/src/Composer.tsx:12:3-14:9  selected text",
  );
});

test("buildSelectionPayload includes both the UI label and the appended message suffix", () => {
  const { buildSelectionPayload } = require("../src/editor-context");
  assert.deepEqual(
    buildSelectionPayload({
      pathLabel: "web/src/App.tsx",
      startLine: 42,
      startCharacter: 7,
      isEmpty: true,
      lineText: "const route = useMemo(() => parseHash(hash), [hash]);",
    }),
    {
      label: "Cursor: web/src/App.tsx:42:7  const route = useMemo(() => parseHash(hash), [hash]);",
      messageSuffix: "[user cursor in VSCode: web/src/App.tsx:42:7] (this may or may not be relevant)",
    },
  );
});

test("summarizeText truncates long previews without changing whitespace semantics", () => {
  assert.equal(
    summarizeText("alpha beta gamma delta", 10),
    "alpha b...",
  );
});
