"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getSelectionApiUrl,
  buildSelectionSyncPayload,
  createSelectionSyncManager,
} = require("../src/selection-sync");

test("getSelectionApiUrl targets the REST selection endpoint on the configured Takode base URL", () => {
  assert.equal(
    getSelectionApiUrl("http://localhost:3456/#/session/demo"),
    "http://localhost:3456/api/vscode/selection",
  );
  assert.equal(
    getSelectionApiUrl("http://localhost:5174/"),
    "http://localhost:5174/api/vscode/selection",
  );
});

test("buildSelectionSyncPayload keeps the server-bound data absolute-path based", () => {
  assert.deepEqual(
    buildSelectionSyncPayload(
      {
        absolutePath: "/workspace/project/web/src/App.tsx",
        startLine: 10,
        endLine: 12,
        lineCount: 3,
      },
      {
        sourceId: "vscode-window:test",
        sourceType: "vscode-window",
        sourceLabel: "VS Code",
      },
      1234,
    ),
    {
      selection: {
        absolutePath: "/workspace/project/web/src/App.tsx",
        startLine: 10,
        endLine: 12,
        lineCount: 3,
      },
      updatedAt: 1234,
      sourceId: "vscode-window:test",
      sourceType: "vscode-window",
      sourceLabel: "VS Code",
    },
  );
});

test("selection sync publishes non-empty selections and clears to all configured base URLs", async () => {
  const calls = [];
  const manager = createSelectionSyncManager({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200 };
    },
    getBaseUrls: () => ["http://localhost:3456", "http://localhost:5174/"],
    getSourceInfo: () => ({
      sourceId: "vscode-window:test",
      sourceType: "vscode-window",
      sourceLabel: "VS Code",
    }),
  });

  await manager.publishSelection({
    absolutePath: "/workspace/project/web/src/App.tsx",
    startLine: 10,
    endLine: 12,
    lineCount: 3,
  });
  await manager.publishSelection(null);

  assert.equal(calls.length, 4);
  const firstPayload = JSON.parse(calls[0].options.body);
  assert.deepEqual(firstPayload.selection, {
    absolutePath: "/workspace/project/web/src/App.tsx",
    startLine: 10,
    endLine: 12,
    lineCount: 3,
  });
  const clearPayload = JSON.parse(calls[2].options.body);
  assert.equal(clearPayload.selection, null);
  assert.equal(clearPayload.sourceType, "vscode-window");
});

test("selection sync deduplicates repeated identical publishes unless forced", async () => {
  const calls = [];
  const manager = createSelectionSyncManager({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200 };
    },
    getBaseUrls: () => ["http://localhost:3456"],
    getSourceInfo: () => ({
      sourceId: "vscode-window:test",
      sourceType: "vscode-window",
    }),
  });

  await manager.publishSelection(null);
  await manager.publishSelection(null);
  await manager.publishSelection(null, { force: true });

  assert.equal(calls.length, 2);
});
