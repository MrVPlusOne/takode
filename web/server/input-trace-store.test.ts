import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InputTraceStore } from "./input-trace-store.js";
import { INPUT_TRACE_WINDOW_MS, type InputTraceBatch } from "../shared/input-trace.js";
import { inputTraceBatchSchema } from "./input-trace-schema.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function batch(seq: number, t: number, traceId = id): InputTraceBatch {
  return {
    traceId,
    recordingSince: 1,
    userAgent: "test-browser",
    platform: "MacIntel",
    events: [{ seq, t, type: "paste", clipboard: { types: ["text/plain"], textLength: 49, files: 0 } }],
  };
}
async function root() {
  const path = await mkdtemp(join(tmpdir(), "input-trace-store-"));
  roots.push(path);
  return path;
}

describe("durable input traces", () => {
  it("survives a restart and merges retries, reversed requests and separate pages", async () => {
    const path = await root();
    const store = new InputTraceStore(path);
    // A pagehide request can overtake a normal upload or repeat events whose acknowledgement was lost.
    await Promise.all([
      store.append(batch(2, 200), 250),
      store.append(batch(1, 100), 251),
      store.append(batch(2, 200), 252),
    ]);
    await store.append(batch(1, 210, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), 253);
    const saved = await new InputTraceStore(path).list(300);
    expect(saved).toHaveLength(2);
    expect(saved.find((trace) => trace.traceId === id)?.events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("exposes only the last hour and removes expired automatic files", async () => {
    const path = await root();
    const store = new InputTraceStore(path);
    await store.append(batch(1, 100), 100);
    await store.append(batch(2, INPUT_TRACE_WINDOW_MS + 101), INPUT_TRACE_WINDOW_MS + 101);
    expect((await store.list(INPUT_TRACE_WINDOW_MS + 101))[0].events.map((e) => e.seq)).toEqual([2]);
    expect(await store.list(2 * INPUT_TRACE_WINDOW_MS + 102)).toEqual([]);
    expect(await readdir(path)).toEqual([]);
  });

  it("rejects payload content fields at the automatic upload boundary", () => {
    const good = batch(1, 100);
    expect(inputTraceBatchSchema.safeParse(good).success).toBe(true);
    expect(
      inputTraceBatchSchema.safeParse({ ...good, events: [{ ...good.events[0], data: "private text" }] }).success,
    ).toBe(false);
    expect(inputTraceBatchSchema.safeParse({ ...good, traceId: "../other-data" }).success).toBe(false);
  });
});
