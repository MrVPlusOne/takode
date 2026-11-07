import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { SessionStore, type PersistedSession } from "./session-store.js";
import * as codec from "./session-history-codec.js";

// Save cost must follow the change, not the history: twice a save that re-read or re-hashed the whole
// history froze the server once histories grew (February 2026 and October 2026). These tests check the
// work an ordinary save does by counting it, never by timing, plus the warning that names a slow save.

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "session-save-cost-"));
  roots.push(root);
  return { root, store: new SessionStore(root) };
}

function session(id: string, messageHistory: PersistedSession["messageHistory"]): PersistedSession {
  return {
    id,
    state: { session_id: id } as PersistedSession["state"],
    messageHistory,
    pendingMessages: [],
    pendingPermissions: [],
    toolResults: [],
  };
}

const result = () => ({ type: "result", data: { type: "result", subtype: "success" } }) as never;

/** Counts reads of a row's payload, so a test can tell whether a save looked at the row. */
function countReads(row: { content: string }): () => number {
  let content = row.content;
  let reads = 0;
  Object.defineProperty(row, "content", {
    enumerable: true,
    configurable: true,
    get: () => {
      reads++;
      return content;
    },
    set: (next: string) => {
      content = next;
    },
  });
  return () => reads;
}

async function head(root: string, id: string) {
  return JSON.parse(await readFile(join(root, `${id}.json`), "utf8"))._historyRef;
}

it("never re-reads saved rows of a small session on an ordinary save, and still saves explicit edits of them", async () => {
  // The small-session format keeps finished turns in an append-only log. Ordinary saves must not read,
  // copy or size them again; only saveHistoryEdits may change a saved row.
  const { root, store } = await setup();
  const value = session("small", [{ type: "user_message", content: "first request", timestamp: 1 }, result()]);
  await store.saveImmediate(value);
  const reads = countReads(value.messageHistory[0] as { content: string });

  value.messageHistory.push({ type: "user_message", content: "second request", timestamp: 2 });
  await store.saveImmediate(value);
  value.messageHistory.push(result());
  await store.saveImmediate(value);
  value.pendingMessages.push("queued");
  await store.saveImmediate(value);
  expect(reads()).toBe(0);
  expect((await new SessionStore(root).load(value.id))?.messageHistory).toEqual(value.messageHistory);

  (value.messageHistory[0] as { content: string }).content = "edited after it was saved";
  await store.saveHistoryEdits(value, [0]);
  expect(reads()).toBeGreaterThan(0);
  expect((await new SessionStore(root).load(value.id))?.messageHistory).toEqual(value.messageHistory);
});

it("hashes and writes only the new rows when one row is added to a 10,000-row history", async () => {
  // About 3 MB of finished turns uses the large-session format. Adding one row must hash a handful of
  // rows and append a few KB, however long the history is. The bounds are loose on purpose: they
  // separate "proportional to the change" from "proportional to the history" by orders of magnitude.
  const { root, store } = await setup();
  const rows: PersistedSession["messageHistory"] = [];
  for (let i = 0; i < 10_000; i++) {
    rows.push(i % 10 === 9 ? result() : { type: "user_message", content: `row ${i} ${"x".repeat(300)}`, timestamp: i });
  }
  const value = session("large", rows);
  await store.saveImmediate(value);
  const before = await head(root, value.id);
  expect(before.messageCount).toBe(10_000);

  const digests = vi.spyOn(codec, "textDigest");
  value.messageHistory.push({ type: "user_message", content: "one more row", timestamp: 10_000 });
  await store.saveImmediate(value);
  const after = await head(root, value.id);

  expect(after.generation).toBe(before.generation);
  expect(digests.mock.calls.length).toBeGreaterThan(0);
  expect(digests.mock.calls.length).toBeLessThan(20);
  expect(after.bytes - before.bytes).toBeLessThan(16 * 1024);
  expect((await new SessionStore(root).load(value.id))?.messageHistory).toEqual(value.messageHistory);
});

it("warns with the session's name and size when a save blocks the event loop, and stays quiet otherwise", async () => {
  // A save that blocks the server must name itself in the log, so a regression is found on its first
  // day. A row whose payload takes 250 ms to read makes the save's admission block that long.
  const { store } = await setup();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

  const quick = session("quick-save", [{ type: "user_message", content: "hello", timestamp: 1 }]);
  await store.saveImmediate(quick);
  await nextTurn();
  expect(warn.mock.calls.flat().join("\n")).not.toContain("Slow save");

  const slowRow = { type: "user_message", timestamp: 1 } as {
    type: "user_message";
    timestamp: number;
    content: string;
  };
  Object.defineProperty(slowRow, "content", {
    enumerable: true,
    get: () => {
      const until = performance.now() + 250;
      while (performance.now() < until) {
        /* hold the event loop */
      }
      return "slow";
    },
  });
  await store.saveImmediate(session("slow-save", [slowRow]));
  await nextTurn();
  const message = warn.mock.calls.flat().join("\n");
  expect(message).toMatch(/Slow save blocked the event loop for \d+ms: session=slow-sav, messages=1, toolResults=0/);
});

/** A history of one unfinished turn (no result yet), about 3 MB, so it uses the large-session format. */
function openTurn(rows: number): PersistedSession["messageHistory"] {
  return Array.from({ length: rows }, (_, i) => ({
    type: "user_message",
    content: `row ${i} ${"x".repeat(300)}`,
    timestamp: i,
  }));
}

it("reads only new rows and a bounded recheck window when a long unfinished turn grows", async () => {
  // Codex steers new input into a running turn, so a busy session's turn may never finish. Saves must still
  // cost the change: before, every save re-read the whole unfinished turn (about 0.3-0.5 s on a 124 MB history).
  const { root, store } = await setup();
  const value = session("open-turn", openTurn(10_000));
  await store.saveImmediate(value);
  value.messageHistory.push({ type: "user_message", content: "second save", timestamp: 10_000 });
  await store.saveImmediate(value); // reads the turn once more: everything was new to the first save

  const digests = vi.spyOn(codec, "textDigest");
  const before = await head(root, value.id);
  value.messageHistory.push({ type: "user_message", content: "third save", timestamp: 10_001 });
  await store.saveImmediate(value);
  const after = await head(root, value.id);

  // One new row, the row the last save found new, and the moving 512-row recheck window.
  expect(digests.mock.calls.length).toBeLessThan(600);
  expect(after.generation).toBe(before.generation);
  expect(after.bytes - before.bytes).toBeLessThan(16 * 1024);
  expect((await new SessionStore(root).load(value.id))?.messageHistory).toEqual(value.messageHistory);
});

it("saves edits of unfinished-turn rows: replaced rows at once, reported edits at once, unreported ones soon and at flush", async () => {
  // Reusing unfinished-turn rows trusts that a row which is still the same object is unchanged. A replaced row is a
  // new object; saveHistoryEdits reports an in-place edit; the moving recheck and flushAll catch one nobody reported.
  const { root, store } = await setup();
  const value = session("open-edits", openTurn(10_000));
  await store.saveImmediate(value);
  await store.saveImmediate(value);
  const saved = async () => (await new SessionStore(root).load(value.id))!.messageHistory as { content?: string }[];

  value.messageHistory[100] = { type: "user_message", content: "replaced", timestamp: 100 };
  await store.saveImmediate(value);
  expect((await saved())[100].content).toBe("replaced");

  (value.messageHistory[200] as { content: string }).content = "reported edit";
  await store.saveHistoryEdits(value, [200]);
  expect((await saved())[200].content).toBe("reported edit");

  // The window moves 512 rows per save, so it reaches any row of a 10,000-row turn within 20 saves.
  (value.messageHistory[5_000] as { content: string }).content = "unreported edit";
  let saves = 0;
  while ((await saved())[5_000].content !== "unreported edit" && saves < 25) {
    await store.saveImmediate(value);
    saves++;
  }
  expect(saves).toBeGreaterThan(0);
  expect(saves).toBeLessThanOrEqual(20);

  (value.messageHistory[9_000] as { content: string }).content = "edited before shutdown";
  await store.flushAll();
  expect((await saved())[9_000].content).toBe("edited before shutdown");
});

it("checks a tool-result tail for replayed duplicates without hashing every earlier preview again", async () => {
  // History ends with a tool result's preview between the tool finishing and the model's next message, so
  // nearly every tool call saves with a preview tail. Re-hashing all earlier previews then blocked the event loop
  // for 250-430 ms per save on a 124 MB session.
  const { root, store } = await setup();
  const preview = (i: number) =>
    ({
      type: "tool_result_preview",
      previews: [
        {
          tool_use_id: `tool-${i}`,
          content: `output ${i} ${"y".repeat(300)}`,
          is_error: false,
          total_size: 310,
          is_truncated: false,
        },
      ],
    }) as never;
  const rows: PersistedSession["messageHistory"] = [];
  for (let i = 0; i < 10_000; i++) rows.push(i % 10 === 9 ? result() : preview(i));
  rows.push(preview(10_000));
  const value = session("preview-tail", rows);
  await store.saveImmediate(value);
  // The first saves read rows as copies; once saved, rows are shared and their keys are remembered.
  value.messageHistory.push(preview(10_000.5));
  await store.saveImmediate(value);

  const digests = vi.spyOn(codec, "valueDigest");
  value.messageHistory.push(preview(10_001));
  await store.saveImmediate(value);
  expect(digests.mock.calls.length).toBeLessThan(20);

  // A replayed copy of an earlier preview at the tail is still left out of the saved history.
  value.messageHistory.push(preview(10_001));
  await store.saveImmediate(value);
  const loaded = (await new SessionStore(root).load(value.id))!.messageHistory;
  expect(loaded).toHaveLength(value.messageHistory.length - 1);
});
