import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelProvenanceMigrationAcknowledgementStore } from "./model-provenance-migration-acknowledgement-store.js";

const tempRoots: string[] = [];

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("model provenance migration acknowledgement store", () => {
  it("persists the first acknowledgement across a fresh store instance", async () => {
    // This destructive persistence check is isolated to a newly-created temporary directory.
    const root = await mkdtemp(join(tmpdir(), "takode-model-provenance-ack-"));
    tempRoots.push(root);
    const path = join(root, "acknowledgements.json");
    const first = new ModelProvenanceMigrationAcknowledgementStore(path);
    await first.load();

    expect(await first.acknowledge("event-a", 123)).toBe(123);
    expect(await first.acknowledge("event-a", 456)).toBe(123);
    await first.flushForTest();

    const restored = new ModelProvenanceMigrationAcknowledgementStore(path);
    await restored.load();
    expect(restored.getAcknowledgedAt("event-a")).toBe(123);
    expect(restored.getAcknowledgedAt("event-b")).toBeUndefined();
  });

  it("coalesces same-event callers until their shared durability write completes", async () => {
    // The in-memory timestamp must remain unpublished until the controlled writer commits.
    const gate = deferred();
    const writer = vi.fn(() => gate.promise);
    const store = new ModelProvenanceMigrationAcknowledgementStore("/disposable/acknowledgements.json", writer);

    const first = store.acknowledge("event-a", 123);
    const duplicate = store.acknowledge("event-a", 456);
    expect(duplicate).toBe(first);
    await vi.waitFor(() => expect(writer).toHaveBeenCalledOnce());
    expect(store.getAcknowledgedAt("event-a")).toBeUndefined();

    gate.resolve();
    await expect(Promise.all([first, duplicate])).resolves.toEqual([123, 123]);
    expect(store.getAcknowledgedAt("event-a")).toBe(123);
    expect(writer).toHaveBeenCalledOnce();
  });

  it("rejects every same-event waiter and publishes nothing when durability fails", async () => {
    // A failed shared write is retryable and cannot leak acknowledgement into runtime projection.
    const gate = deferred();
    const failure = new Error("controlled write failure");
    const writer = vi
      .fn()
      .mockImplementationOnce(() => gate.promise)
      .mockResolvedValueOnce(undefined);
    const store = new ModelProvenanceMigrationAcknowledgementStore("/disposable/acknowledgements.json", writer);

    const first = store.acknowledge("event-a", 123);
    const duplicate = store.acknowledge("event-a", 456);
    expect(duplicate).toBe(first);
    await vi.waitFor(() => expect(writer).toHaveBeenCalledOnce());
    gate.reject(failure);

    const results = await Promise.allSettled([first, duplicate]);
    expect(results).toEqual([
      { status: "rejected", reason: failure },
      { status: "rejected", reason: failure },
    ]);
    expect(store.getAcknowledgedAt("event-a")).toBeUndefined();
    await expect(store.acknowledge("event-a", 789)).resolves.toBe(789);
    expect(store.getAcknowledgedAt("event-a")).toBe(789);
  });
});
