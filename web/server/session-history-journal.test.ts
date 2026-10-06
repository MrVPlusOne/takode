import { mkdtemp, readFile, writeFile, appendFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SessionStore, type PersistedSession } from "./session-store.js";
import { historyPath, HistoryFrameWriter, type HistoryReference } from "./session-history-journal.js";
import * as io from "./session-persistence-io.js";
import * as historyIO from "./session-history-journal.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "incremental-history-"));
  roots.push(root);
  const value: PersistedSession = {
    id: "large",
    state: { session_id: "large" } as PersistedSession["state"],
    messageHistory: [{ type: "user_message", content: "\0😀\ud800x".repeat(110000), timestamp: 1 }],
    pendingMessages: ["keep-owned"],
    pendingPermissions: [],
    toolResults: [["tool", { content: "tool\0\udfff", timestamp: 1, is_error: false }]],
  };
  return { root, value, store: new SessionStore(root) };
}
async function head(root: string): Promise<HistoryReference> {
  return JSON.parse(await readFile(join(root, "large.json"), "utf8"))._historyRef;
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, promise };
}

it("round-trips chunked Unicode, literal marker-like values and property names through completion", async () => {
  // Deliberately splits surrogate pairs and includes lone surrogates/NUL. No typed marker is user data.
  const { root, value, store } = await setup();
  Object.defineProperty(value.messageHistory[0], "__proto__", { value: { literal: "\0ref" }, enumerable: true });
  await store.saveImmediate(value);
  const before = await head(root);
  expect((await readFile(join(root, "large.json"))).length).toBeLessThan(2000);
  expect((await new SessionStore(root).load(value.id))?.messageHistory).toEqual(value.messageHistory);
  value.messageHistory.push({ type: "result", data: { subtype: "success" } } as never);
  await store.saveImmediate(value);
  const after = await head(root);
  expect(after.generation).toBe(before.generation);
  expect(after.bytes - before.bytes).toBeLessThan(1000);
  expect(after.frozenCount).toBe(2);
  expect((await new SessionStore(root).load(value.id))?.toolResults).toEqual(value.toolResults);
  expect(await readdir(root)).not.toContain("large.history.jsonl");
});

it("captures nested state at admission and holds reads behind the complete ownership save", async () => {
  const { root, value, store } = await setup();
  const held = gate(),
    entered = gate();
  const flush = HistoryFrameWriter.prototype.flush;
  let first = true;
  vi.spyOn(HistoryFrameWriter.prototype, "flush").mockImplementation(async function (this: HistoryFrameWriter) {
    if (first) {
      first = false;
      entered.release();
      await held.promise;
    }
    await flush.call(this);
  });
  const expected = structuredClone(value);
  const saving = store.saveImmediate(value);
  await entered.promise;
  (value.messageHistory[0] as { content: string }).content = "changed after admission";
  value.pendingMessages.length = 0;
  let loaded = false;
  const reading = store.load(value.id).then((v) => {
    loaded = true;
    return v;
  });
  expect(loaded).toBe(false);
  held.release();
  await saving;
  expect((await reading)?.messageHistory).toEqual(expected.messageHistory);
  expect((await new SessionStore(root).load(value.id))?.pendingMessages).toEqual(expected.pendingMessages);
});

it("keeps the old committed prefix on failed publication and reconstructs an exact retry", async () => {
  const { root, value, store } = await setup();
  await store.saveImmediate(value);
  const before = await head(root);
  const old = await readFile(join(root, "large.json"), "utf8");
  value.messageHistory.push({ type: "user_message", content: "new pending", timestamp: 2 });
  const replace = vi.spyOn(io, "replaceSessionFile").mockRejectedValueOnce(new Error("injected head failure"));
  await expect(store.saveImmediate(value)).rejects.toThrow("injected head failure");
  await expect(store.flushAll()).rejects.toThrow("Unsaved session");
  expect(await readFile(join(root, "large.json"), "utf8")).toBe(old);
  expect((await readFile(historyPath(root, value.id, before.generation))).length).toBe(before.bytes);
  replace.mockRestore();
  await store.saveImmediate(value);
  await store.flushAll();
  expect((await new SessionStore(root).load(value.id))?.messageHistory).toEqual(value.messageHistory);
});

it("rejects interrupted data writes and retries without advancing a committed head", async () => {
  const { root, value, store } = await setup();
  await store.saveImmediate(value);
  const old = await readFile(join(root, "large.json"), "utf8");
  (value.messageHistory[0] as { content: string }).content += "new";
  const flush = HistoryFrameWriter.prototype.flush;
  const spy = vi.spyOn(HistoryFrameWriter.prototype, "flush").mockImplementationOnce(async function (
    this: HistoryFrameWriter,
  ) {
    await flush.call(this);
    throw new Error("partial data failure");
  });
  await expect(store.saveImmediate(value)).rejects.toThrow("partial data failure");
  expect(await readFile(join(root, "large.json"), "utf8")).toBe(old);
  spy.mockRestore();
  await store.saveImmediate(value);
  expect((await store.load(value.id))?.messageHistory).toEqual(value.messageHistory);
});

it("reclaims obsolete string versions, prunes reverted rows and never resurrects a removed tail", async () => {
  const { root, value, store } = await setup();
  await store.saveImmediate(value);
  const initial = await head(root);
  for (let i = 0; i < 5; i++) {
    (value.messageHistory[0] as { content: string }).content = String(i).repeat(550000);
    await store.saveImmediate(value);
  }
  const latest = await head(root);
  expect(latest.generation).not.toBe(initial.generation);
  expect((await readdir(root)).filter((p) => p.endsWith(".data"))).toHaveLength(1);
  expect(latest.bytes).toBeLessThan(1200000);
  value.messageHistory.push({ type: "user_message", content: "removed", timestamp: 2 });
  await store.saveImmediate(value);
  value.messageHistory.pop();
  await store.saveImmediate(value);
  value.messageHistory.push({ type: "user_message", content: "replacement", timestamp: 3 });
  await store.saveImmediate(value);
  expect((await new SessionStore(root).load(value.id))?.messageHistory).toEqual(value.messageHistory);
});

it("ignores physical uncommitted suffixes but fails both full load and startup on committed corruption", async () => {
  const { root, value, store } = await setup();
  await store.saveImmediate(value);
  const ref = await head(root),
    path = historyPath(root, value.id, ref.generation);
  const bytes = await readFile(path);
  await appendFile(path, "unfinished suffix");
  expect((await new SessionStore(root).load(value.id))?.messageHistory).toEqual(value.messageHistory);
  await writeFile(path, bytes.subarray(0, bytes.length - 1));
  await expect(new SessionStore(root).load(value.id)).rejects.toThrow("committed history");
  await expect(new SessionStore(root).loadAll()).rejects.toThrow("committed history");
});

it("keeps legacy frozen originals, rewrites new-format metadata without a nested queue and releases archived caches", async () => {
  const { root, value, store } = await setup();
  const content = (value.messageHistory[0] as { content: string }).content;
  (value.messageHistory[0] as { content: string }).content = "small";
  value.messageHistory.push({ type: "result", data: {} } as never);
  await store.saveImmediate(value);
  const frozen = await readFile(join(root, "large.history.jsonl"));
  value.messageHistory.push({ type: "user_message", content, timestamp: 2 });
  await store.saveImmediate(value);
  (value.messageHistory[0] as { content: string }).content = "metadata repair";
  await store.rewriteFrozenHistoryMetadata(value, 2);
  expect((await store.load(value.id))?.messageHistory).toEqual(value.messageHistory);
  expect(await readFile(join(root, "large.history.jsonl"))).toEqual(frozen);
  await store.setArchived(value.id, true);
  expect((await store.loadAll())[0]._searchDataOnly).toBe(true);
  await store.setArchived(value.id, false);
  expect((await store.load(value.id))?.messageHistory).toEqual(value.messageHistory);
  expect((await readdir(root)).filter((p) => p.endsWith(".data"))).toHaveLength(1);
});

it("coalesces large pending saves before capture and retains only current strings after a burst", async () => {
  const { root, value, store } = await setup();
  const held = gate(),
    entered = gate(),
    replace = io.replaceSessionFile;
  let commits = 0;
  vi.spyOn(io, "replaceSessionFile").mockImplementation(async (path, chunks) => {
    commits++;
    if (commits === 1) {
      entered.release();
      await held.promise;
    }
    await replace(path, chunks);
  });
  const first = store.saveSync(value);
  await entered.promise;
  let last: Promise<boolean> | undefined;
  for (let i = 0; i < 24; i++) {
    (value.messageHistory[0] as { content: string }).content = `${i}`.repeat(550000);
    const saving = store.saveSync(value);
    if (last) expect(saving).toBe(last);
    last = saving;
  }
  held.release();
  expect(await first).toBe(true);
  expect(await last).toBe(true);
  expect(commits).toBe(2);
  expect((await new SessionStore(root).load(value.id))?.messageHistory).toEqual(value.messageHistory);
  // Cache ownership is a contractual memory property, separate from disk size/reconstruction.
  const caches = (store as unknown as { historyJournal: { caches: Map<string, { strings: Map<string, unknown> }> } })
    .historyJournal.caches;
  const largeStrings = [...caches.get(value.id)!.strings.keys()].filter((s) => s.length > 500000);
  expect(largeStrings).toEqual([(value.messageHistory[0] as { content: string }).content]);
  await store.setArchived(value.id, true);
  expect(caches.has(value.id)).toBe(false);
});

it("holds a generation until an admitted reader finishes before reclaiming it", async () => {
  const { root, value, store } = await setup();
  await store.saveImmediate(value);
  const old = await head(root);
  const entered = gate(),
    held = gate(),
    read = historyIO.readSessionHistory;
  vi.spyOn(historyIO, "readSessionHistory").mockImplementationOnce(async (...args) => {
    entered.release();
    await held.promise;
    return read(...args);
  });
  const reading = store.load(value.id);
  await entered.promise;
  const original = structuredClone(value.messageHistory);
  value.messageHistory = [{ type: "user_message", content: "short surviving state", timestamp: 3 }];
  const writing = store.saveImmediate(value);
  expect(await readFile(historyPath(root, value.id, old.generation))).toBeDefined();
  held.release();
  expect((await reading)?.messageHistory).toEqual(original);
  await writing;
  expect((await head(root)).generation).not.toBe(old.generation);
  await expect(readFile(historyPath(root, value.id, old.generation))).rejects.toThrow();
});

it("discards uncommitted suffix on reuse and handles successful remove followed by an ordinary small session", async () => {
  const { root, value, store } = await setup();
  await store.saveImmediate(value);
  const committed = await head(root);
  await appendFile(historyPath(root, value.id, committed.generation), "not committed");
  value.toolResults![0][1].content = "updated tool";
  await store.saveImmediate(value);
  expect((await new SessionStore(root).load(value.id))?.toolResults).toEqual(value.toolResults);
  store.remove(value.id);
  await store.flushAll();
  expect(await readdir(root)).toEqual([]);
  value.messageHistory = [];
  await store.saveImmediate(value);
  expect(await head(root)).toBeUndefined();
});

it("retains the format when a fresh store saves a shorter complete revision without an earlier load", async () => {
  const { root, value, store } = await setup();
  await store.saveImmediate(value);
  const previous = await head(root);
  value.messageHistory = [];
  await new SessionStore(root).saveImmediate(value);
  expect((await head(root)).generation).not.toBe(previous.generation);
  expect((await new SessionStore(root).load(value.id))?.messageHistory).toEqual([]);
  expect((await readdir(root)).filter((p) => p.endsWith(".data"))).toHaveLength(1);
});

it("archives the latest accepted debounced state without a later timer undoing the archive", async () => {
  const { root, value, store } = await setup();
  await store.saveImmediate(value);
  value.pendingMessages.push("accepted before archive");
  store.save(value);
  await store.setArchived(value.id, true);
  await store.flushAll();
  const loaded = await new SessionStore(root).load(value.id);
  expect(loaded?.archived).toBe(true);
  expect(loaded?.pendingMessages).toEqual(value.pendingMessages);
});
