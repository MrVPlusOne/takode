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

  const digests = vi.spyOn(codec, "valueDigest");
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
