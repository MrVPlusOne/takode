import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { migrateExperimentalSessionTail } from "../scripts/migrate-experimental-session-tail.js";
import { SessionStore } from "./session-store.js";
import { SourceJson } from "../scripts/experimental-tail-json.js";
import * as io from "./session-persistence-io.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(id = "source") {
  // Everything, including backup, failure injection and rollback, is under an owned disposable root.
  const root = await mkdtemp(join(tmpdir(), "offline-tail-converter-"));
  roots.push(root);
  const sessionsDirectory = join(root, "sessions"),
    backupDirectory = join(root, "backup");
  await mkdir(sessionsDirectory);
  const huge = "x😀\0\ud800".repeat(45000);
  const message = JSON.parse(
    '{"type":"user_message","content":"\\u00001","timestamp":1,"__proto__":{"literal":"\\u0000\\u0000x"}}',
  );
  const records = [
    ["s", 0, "obsolete".repeat(30000)],
    ["s", 1, huge],
    ["m", 0, message],
    ["t", 0, ["tool", { content: "\0\0literal", timestamp: 2, is_error: false }]],
    ["c", 1, 0, 1, 0, 1],
  ];
  const journal = records.map((record) => JSON.stringify(record) + "\n").join("");
  const hot = {
    id,
    state: { session_id: id },
    messageHistory: [],
    toolResults: [],
    pendingMessages: ["keep"],
    pendingPermissions: [],
    pendingCodexInputs: [{ source: "human", clientMessageId: "owned", text: "keep me" }],
    unknownMetadata: { content: "\0not-a-reference", marker: "_tailJournal" },
    _frozenCount: 0,
    _frozenToolResultCount: 0,
    _tailJournal: { version: 1, revision: 1, bytes: Buffer.byteLength(journal) },
  };
  await writeFile(join(sessionsDirectory, `${id}.json`), JSON.stringify(hot));
  await writeFile(join(sessionsDirectory, `${id}.tail.jsonl`), journal + "physical uncommitted suffix\0");
  return {
    root,
    sessionsDirectory,
    backupDirectory,
    id,
    hot,
    records,
    journal,
    huge,
    options: { sessionsDirectory, backupDirectory, serverStopped: true as const },
  };
}

it("streams a giant source line, preserves originals/pending metadata and can resume or roll back exactly", async () => {
  const f = await fixture();
  // Real stores include an array-shaped launcher catalog and unconverted small sessions.
  const launcher = JSON.stringify([{ sessionId: f.id, state: "exited" }]);
  await writeFile(join(f.sessionsDirectory, "launcher.json"), launcher);
  await writeFile(join(f.sessionsDirectory, "small.json"), JSON.stringify({ id: "small", messageHistory: [] }));
  // Reject a whole-line parser: the large dictionary record exceeds this limit,
  // while bounded generic frames, scalars and the compact receipt stay below it.
  const parse = JSON.parse;
  vi.spyOn(JSON, "parse").mockImplementation((text, reviver) => {
    if (text.length > 128 * 1024) throw new Error("Unbounded JSON parse");
    return parse(text, reviver);
  });
  const originalHot = await readFile(join(f.sessionsDirectory, "source.json"));
  const originalTail = await readFile(join(f.sessionsDirectory, "source.tail.jsonl"));
  const result = await migrateExperimentalSessionTail(f.options);
  expect(result.status).toBe("complete");
  expect(result.sessions).toBe(1);
  expect(await readFile(join(f.sessionsDirectory, "launcher.json"), "utf8")).toBe(launcher);
  const restored = await new SessionStore(f.sessionsDirectory).load(f.id);
  expect((restored!.messageHistory[0] as { content: string }).content).toBe(f.huge);
  expect(Object.getOwnPropertyDescriptor(restored!.messageHistory[0], "__proto__")?.value).toEqual({ literal: "\0x" });
  expect(restored!.toolResults).toEqual([["tool", { content: "\0literal", timestamp: 2, is_error: false }]]);
  expect(restored!.pendingCodexInputs).toEqual(f.hot.pendingCodexInputs);
  expect((restored as unknown as typeof f.hot).unknownMetadata).toEqual(f.hot.unknownMetadata);
  expect(await readFile(join(f.backupDirectory, f.id, "originals", "source.tail.jsonl"))).toEqual(originalTail);
  expect(await readFile(join(f.backupDirectory, f.id, "originals", "source.json"))).toEqual(originalHot);
  expect(await migrateExperimentalSessionTail(f.options)).toEqual(result);
  expect((await readdir(f.sessionsDirectory)).filter((p) => p.endsWith(".data"))).toHaveLength(1);
  expect((await migrateExperimentalSessionTail({ ...f.options, rollback: true })).status).toBe("rolled-back");
  expect(await readFile(join(f.sessionsDirectory, "source.json"))).toEqual(originalHot);
  expect(await readFile(join(f.sessionsDirectory, "source.tail.jsonl"))).toEqual(originalTail);
});

it("reconciles exact frozen overlap and rejects conflicting or incomplete frozen content", async () => {
  for (const conflict of [false, true]) {
    const f = await fixture();
    const exact = JSON.parse(JSON.stringify(f.records[2][2]));
    exact.content = conflict ? "wrong value" : f.huge;
    Object.defineProperty(exact, "__proto__", { value: { literal: "\0x" }, enumerable: true });
    await writeFile(
      join(f.sessionsDirectory, "source.history.jsonl"),
      JSON.stringify({ v: 1, sessionId: f.id }) + "\n" + JSON.stringify(exact) + "\n",
    );
    if (conflict)
      await expect(migrateExperimentalSessionTail(f.options)).rejects.toThrow("Conflicting frozen/journal overlap");
    else {
      await migrateExperimentalSessionTail(f.options);
      expect((await new SessionStore(f.sessionsDirectory).load(f.id))?.messageHistory).toEqual([exact]);
    }
  }
});

it("detects source activity after staging and preserves every original head", async () => {
  const f = await fixture(),
    replace = io.replaceSessionFile;
  const original = await readFile(join(f.sessionsDirectory, "source.json"));
  let changed = false;
  vi.spyOn(io, "replaceSessionFile").mockImplementation(async (path, chunks) => {
    const text = [...chunks].join("");
    await replace(path, [text]);
    if (!changed && text.includes('"output"')) {
      changed = true;
      await writeFile(join(f.sessionsDirectory, "source.tail.jsonl"), f.journal + "new physical suffix");
    }
  });
  await expect(migrateExperimentalSessionTail(f.options)).rejects.toThrow("File changed");
  expect(await readFile(join(f.sessionsDirectory, "source.json"))).toEqual(original);
});

it("preserves huge literal keys and metadata by range without turning them into control markers", async () => {
  const f = await fixture();
  const key = "\0key".repeat(5000);
  const hot = { ...f.hot, [key]: "\ud800metadata" };
  await writeFile(join(f.sessionsDirectory, "source.json"), JSON.stringify(hot));
  const message = f.records[2][2] as Record<string, unknown>;
  message[key] = "\0\0literal";
  const journal = f.records.map((r) => JSON.stringify(r) + "\n").join("");
  hot._tailJournal.bytes = Buffer.byteLength(journal);
  await writeFile(join(f.sessionsDirectory, "source.json"), JSON.stringify(hot));
  await writeFile(join(f.sessionsDirectory, "source.tail.jsonl"), journal);
  await migrateExperimentalSessionTail(f.options);
  const loaded = await new SessionStore(f.sessionsDirectory).load(f.id);
  expect((loaded as unknown as Record<string, unknown>)[key]).toBe("\ud800metadata");
  expect((loaded!.messageHistory[0] as unknown as Record<string, unknown>)[key]).toBe("\0literal");
});

it("resumes a crash after head publication but before receipt acknowledgement without double conversion", async () => {
  const f = await fixture();
  const replace = io.replaceSessionFile;
  let failed = false;
  vi.spyOn(io, "replaceSessionFile").mockImplementation(async (path, chunks) => {
    const text = [...chunks].join("");
    if (!failed && text.includes('"completed": true')) {
      failed = true;
      throw new Error("receipt interruption");
    }
    await replace(path, [text]);
  });
  await expect(migrateExperimentalSessionTail(f.options)).rejects.toThrow("receipt interruption");
  const partial = await readFile(join(f.sessionsDirectory, "source.json"));
  expect((await migrateExperimentalSessionTail(f.options)).status).toBe("complete");
  expect(await readFile(join(f.sessionsDirectory, "source.json"))).toEqual(partial);
  expect((await new SessionStore(f.sessionsDirectory).load(f.id))?.messageHistory).toHaveLength(1);
});

it("validates the whole selected set before publishing any session", async () => {
  const f = await fixture();
  const old = await readFile(join(f.sessionsDirectory, "source.json"));
  await writeFile(join(f.sessionsDirectory, "invalid.json"), JSON.stringify({ ...f.hot, id: "invalid" }));
  await writeFile(join(f.sessionsDirectory, "invalid.tail.jsonl"), f.journal.replace('"\\u00001"', '"\\u00009"'));
  await expect(migrateExperimentalSessionTail(f.options)).rejects.toThrow();
  expect(await readFile(join(f.sessionsDirectory, "source.json"))).toEqual(old);
});

it.each([
  "missing-string",
  "inflated-count",
  "wrong-revision",
  "unknown-record",
  "partial-commit",
  "trailing-row",
  "unsupported-version",
  "missing-frozen",
  "missing-sidecar",
])("rejects %s without changing authoritative files", async (kind) => {
  const f = await fixture();
  if (kind === "missing-string") f.records.splice(1, 1);
  if (kind === "inflated-count") f.records[f.records.length - 1] = ["c", 1, 0, 999999999, 0, 1];
  if (kind === "wrong-revision") f.hot._tailJournal.revision = 2;
  if (kind === "unknown-record") f.records.unshift(["unknown", 0, 1]);
  if (kind === "trailing-row") f.records.push(["m", 1, {}]);
  if (kind === "unsupported-version") f.hot._tailJournal.version = 2;
  if (kind === "missing-frozen") {
    f.hot._frozenCount = 1;
    f.records[f.records.length - 1] = ["c", 1, 1, 0, 0, 1];
  }
  let journal = f.records.map((r) => JSON.stringify(r) + "\n").join("");
  if (kind === "partial-commit") journal = journal.slice(0, -1);
  f.hot._tailJournal.bytes = Buffer.byteLength(journal);
  const hot = JSON.stringify(f.hot);
  await writeFile(join(f.sessionsDirectory, "source.json"), hot);
  await writeFile(join(f.sessionsDirectory, "source.tail.jsonl"), journal);
  if (kind === "missing-sidecar") await rm(join(f.sessionsDirectory, "source.tail.jsonl"));
  await expect(migrateExperimentalSessionTail(f.options)).rejects.toThrow();
  expect(await readFile(join(f.sessionsDirectory, "source.json"), "utf8")).toBe(hot);
});

it("refuses rollback after new-code state and requires explicit disjoint offline paths", async () => {
  const f = await fixture();
  await expect(migrateExperimentalSessionTail({ ...f.options, serverStopped: false as never })).rejects.toThrow(
    "actual server exit",
  );
  await expect(
    migrateExperimentalSessionTail({ ...f.options, backupDirectory: join(f.sessionsDirectory, "backup") }),
  ).rejects.toThrow("separate");
  await migrateExperimentalSessionTail(f.options);
  const store = new SessionStore(f.sessionsDirectory),
    loaded = (await store.load(f.id))!;
  loaded.pendingMessages.push("subsequent work");
  await store.saveImmediate(loaded);
  await expect(migrateExperimentalSessionTail({ ...f.options, rollback: true })).rejects.toThrow();
  expect((await store.load(f.id))?.pendingMessages).toContain("subsequent work");
});

it("parses values with UTF-8/escape boundaries without retaining strings in its index", async () => {
  const f = await fixture();
  const path = join(f.root, "json-source");
  const expected = ["😀".repeat(17000) + '\ud800\0\\"', { __proto__: null }, [null, true, -1.25e20]];
  await writeFile(path, JSON.stringify(expected));
  const source = await SourceJson.open(path);
  try {
    const node = await source.value();
    expect(node.kind).toBe("array");
    if (node.kind !== "array" || node.items[0].kind !== "string") throw new Error("Unexpected test node");
    expect(node.items[0]).not.toHaveProperty("value");
    const parts: string[] = [];
    for await (const part of source.parts(node.items[0])) {
      expect(part.length).toBeLessThanOrEqual(16384);
      parts.push(part);
    }
    expect(parts.join("")).toBe(expected[0]);
  } finally {
    await source.file.close();
  }
});
