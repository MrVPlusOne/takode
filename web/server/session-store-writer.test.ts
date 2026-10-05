import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { SessionStore, type PersistedSession } from "./session-store.js";
import * as io from "./session-persistence-io.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "session-writer-"));
  roots.push(root);
  return { root, store: new SessionStore(root) };
}

function session(id: string, revision = "initial"): PersistedSession {
  return {
    id,
    state: { session_id: id, model: revision } as PersistedSession["state"],
    messageHistory: [{ type: "user_message", id: "u", content: "keep me", timestamp: 1 }],
    pendingMessages: [revision],
    pendingPermissions: [],
  };
}

function completed(id: string): PersistedSession {
  const value = session(id);
  value.messageHistory.push({ type: "result", data: { type: "result", subtype: "success" } } as never);
  return value;
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

it("coalesces a blocked writer's ordinary revisions before allocating snapshots", async () => {
  // One admitted 256 KiB snapshot, then one newest pending state: no per-call
  // JSON backlog. Appended authoritative messages must survive coalescing.
  const { root, store } = await setup();
  const hold = gate();
  const replace = io.replaceSessionFile;
  const snapshots: PersistedSession[] = [];
  vi.spyOn(io, "replaceSessionFile").mockImplementation(async (path, chunks) => {
    const data = [...chunks].join("");
    snapshots.push(JSON.parse(data));
    if (snapshots.length === 1) await hold.promise;
    await replace(path, [data]);
  });
  const value = session("coalesced");
  value.messageHistory[0] = { type: "user_message", content: "x".repeat(256 * 1024), timestamp: 1 };
  const first = store.saveSync(value);
  let latest!: Promise<boolean>;
  try {
    for (let revision = 0; revision < 100; revision++) {
      value.messageHistory.push({ type: "user_message", content: `update-${revision}`, timestamp: revision + 2 });
      value.state.model = `revision-${revision}`;
      const pending = store.saveSync(value);
      if (latest) expect(pending).toBe(latest);
      latest = pending;
    }
    expect(snapshots).toHaveLength(1);
  } finally {
    hold.release();
  }
  expect(await first).toBe(true);
  expect(await latest).toBe(true);
  await store.flushAll();
  expect(snapshots).toHaveLength(2);
  expect(snapshots[0]!.messageHistory).toHaveLength(1);
  const restored = await new SessionStore(root).load(value.id);
  expect(restored?.messageHistory).toEqual(value.messageHistory);
  expect(restored?.state.model).toBe("revision-99");
});

it("bounds aggregate admitted snapshots and lets other sessions progress", async () => {
  // A slow filesystem must not admit every session at once. Busy sessions
  // rotate after their current commit rather than occupying a slot indefinitely.
  const { store } = await setup();
  const hold = gate();
  const replace = io.replaceSessionFile;
  const order: string[] = [];
  let active = 0;
  let peak = 0;
  vi.spyOn(io, "replaceSessionFile").mockImplementation(async (path, chunks) => {
    order.push(JSON.parse([...chunks].join("")).id);
    active++;
    peak = Math.max(peak, active);
    try {
      await hold.promise;
      await replace(path, chunks);
    } finally {
      active--;
    }
  });
  const saves = Array.from({ length: 8 }, (_, index) => store.saveSync(session(`session-${index}`)));
  saves.push(store.saveSync(session("session-0", "newer")));
  try {
    expect(order).toEqual(["session-0", "session-1"]);
  } finally {
    hold.release();
  }
  expect((await Promise.all(saves)).every(Boolean)).toBe(true);
  expect(peak).toBe(2);
  expect(order.indexOf("session-2")).toBeLessThan(order.lastIndexOf("session-0"));
});

it("does not coalesce ordinary updates across an immediate ownership barrier", async () => {
  const { root, store } = await setup();
  const hold = gate();
  const replace = io.replaceSessionFile;
  const revisions: string[] = [];
  vi.spyOn(io, "replaceSessionFile").mockImplementation(async (path, chunks) => {
    const data = [...chunks].join("");
    revisions.push(JSON.parse(data).state.model);
    if (revisions.length === 1) await hold.promise;
    await replace(path, [data]);
  });
  const first = store.saveSync(session("ownership", "first"));
  const ordinary = store.saveSync(session("ownership", "before"));
  const barrier = store.saveImmediate(session("ownership", "owner-transfer"));
  const newest = store.saveSync(session("ownership", "after"));
  hold.release();
  await Promise.all([first, ordinary, barrier, newest]);
  expect(revisions).toEqual(["first", "before", "owner-transfer", "after"]);
  expect((await new SessionStore(root).load("ownership"))?.pendingMessages).toEqual(["after"]);
});

it("makes immediate saves wait for frozen history before replacing active state", async () => {
  // Reproduces the original ordering gap with a real old file and a controlled
  // append boundary; the old file must remain authoritative until history lands.
  const { root, store } = await setup();
  const value = completed("ordered");
  await store.saveImmediate(value);
  const oldHot = await readFile(join(root, "ordered.json"), "utf8");
  const hold = gate();
  const append = io.writeFrozenHistory;
  vi.spyOn(io, "writeFrozenHistory").mockImplementation(async (...args) => {
    await hold.promise;
    await append(...args);
  });
  value.messageHistory.push(...completed("next").messageHistory);
  let acknowledged = false;
  const saving = store.saveImmediate(value).then(() => {
    acknowledged = true;
  });
  try {
    expect(acknowledged).toBe(false);
    expect(await readFile(join(root, "ordered.json"), "utf8")).toBe(oldHot);
  } finally {
    hold.release();
  }
  await saving;
  expect((await new SessionStore(root).load(value.id))?.messageHistory).toEqual(value.messageHistory);
});

it("retains failed history and ownership, reports flush failure, and retries without duplicate records", async () => {
  const { root, store } = await setup();
  const value = completed("retry");
  await store.saveImmediate(value);
  const oldHot = await readFile(join(root, "retry.json"), "utf8");
  value.messageHistory.push(...completed("later").messageHistory);
  value.pendingMessages = ["owned pending work"];
  const failing = vi.spyOn(io, "writeFrozenHistory").mockRejectedValueOnce(new Error("injected disk failure"));
  await expect(store.saveImmediate(value)).rejects.toThrow("injected disk failure");
  await expect(store.flushAll()).rejects.toThrow("frozen:retry");
  expect(await readFile(join(root, "retry.json"), "utf8")).toBe(oldHot);
  failing.mockRestore();
  await store.saveImmediate(value);
  await store.flushAll();
  const restored = await new SessionStore(root).load(value.id);
  expect(restored?.messageHistory).toEqual(value.messageHistory);
  expect(restored?.pendingMessages).toEqual(value.pendingMessages);
});

it("does not append a synced history segment again after active replacement fails", async () => {
  const { root, store } = await setup();
  const value = completed("hot-retry");
  await store.saveImmediate(value);
  value.messageHistory.push(...completed("next").messageHistory);
  const failing = vi.spyOn(io, "replaceSessionFile").mockRejectedValueOnce(new Error("replacement failed"));
  await expect(store.saveImmediate(value)).rejects.toThrow("replacement failed");
  failing.mockRestore();
  await store.saveImmediate(value);
  await store.flushAll();
  expect((await new SessionStore(root).load(value.id))?.messageHistory).toEqual(value.messageHistory);
});

it("keeps the surviving history recoverable if a revert's frozen rewrite fails", async () => {
  // The temporary full hot snapshot makes the two-file rewrite crash-safe
  // without a new disk format. A restart must see all selected survivors.
  const { root, store } = await setup();
  const value = completed("revert");
  value.messageHistory.push(...completed("later").messageHistory);
  await store.saveImmediate(value);
  value.messageHistory = value.messageHistory.slice(0, 3);
  const failing = vi.spyOn(io, "writeFrozenHistory").mockRejectedValueOnce(new Error("rewrite failed"));
  await expect(store.saveImmediate(value)).rejects.toThrow("rewrite failed");
  expect((await new SessionStore(root).load(value.id))?.messageHistory).toEqual(value.messageHistory);
  failing.mockRestore();
  await store.saveImmediate(value);
  await store.flushAll();
  expect((await new SessionStore(root).load(value.id))?.messageHistory).toEqual(value.messageHistory);
});

it("orders removal after a blocked save so the file cannot be resurrected", async () => {
  const { root, store } = await setup();
  const hold = gate();
  const replace = io.replaceSessionFile;
  vi.spyOn(io, "replaceSessionFile").mockImplementation(async (...args) => {
    await hold.promise;
    await replace(...args);
  });
  const saving = store.saveSync(session("removed"));
  store.remove("removed");
  hold.release();
  await saving;
  await store.flushAll();
  expect(await new SessionStore(root).load("removed")).toBeNull();
});

it("preserves a queued revert even when new input grows the same array back to its old length", async () => {
  // Coalescing by final length alone would keep the obsolete frozen records and
  // silently lose the replacement turn. The revert must own a queue boundary.
  const { root, store } = await setup();
  const value = completed("revert-append");
  value.messageHistory.push(...completed("obsolete").messageHistory);
  await store.saveImmediate(value);
  const hold = gate();
  const replace = io.replaceSessionFile;
  let writes = 0;
  vi.spyOn(io, "replaceSessionFile").mockImplementation(async (...args) => {
    if (writes++ === 0) await hold.promise;
    await replace(...args);
  });
  const first = store.saveSync(value);
  value.messageHistory = value.messageHistory.slice(0, 2);
  store.save(value);
  value.messageHistory.push(
    { type: "user_message", content: "replacement", timestamp: 3 },
    completed("next").messageHistory[1]!,
  );
  const newest = store.saveSync(value);
  hold.release();
  await Promise.all([first, newest]);
  await store.flushAll();
  expect((await new SessionStore(root).load(value.id))?.messageHistory).toEqual(value.messageHistory);
});

it("parses each hot file only once at startup and preserves streamed Unicode history", async () => {
  const { root, store } = await setup();
  const value = completed("startup");
  value.messageHistory[0] = { type: "user_message", content: "雪🌊".repeat(24000), timestamp: 1 };
  await store.saveImmediate(value);
  // Retain the existing tolerant JSONL behavior across chunks and a final line
  // without newline. One malformed record must not discard later valid data.
  const logPath = join(root, "startup.history.jsonl");
  const frozen = await readFile(logPath, "utf8");
  await writeFile(
    logPath,
    frozen.replace(/\n$/, "") +
      "\nmalformed\n" +
      JSON.stringify({ type: "user_message", content: "tail", timestamp: 2 }),
  );
  const parse = JSON.parse;
  let hotParses = 0;
  vi.spyOn(JSON, "parse").mockImplementation((...args) => {
    const parsed = parse(...args);
    if (parsed?.id === value.id && Array.isArray(parsed.messageHistory)) hotParses++;
    return parsed;
  });
  const loaded = await new SessionStore(root).loadAll();
  expect(hotParses).toBe(1);
  expect(loaded[0]?.messageHistory.slice(0, 2)).toEqual(value.messageHistory);
  expect(loaded[0]?.messageHistory.at(-1)).toMatchObject({ content: "tail" });
});
