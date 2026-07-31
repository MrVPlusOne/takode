import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_FILENAME,
  MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_TEMP_FILENAME,
  ModelProvenanceMigrationAcknowledgementStore,
  modelProvenanceMigrationAcknowledgementTempPath,
  replaceModelProvenanceMigrationAcknowledgementsAtomically,
} from "./model-provenance-migration-acknowledgement-store.js";

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

  it("atomically preserves A when B replacement fails, then persists A+B on retry", async () => {
    // The rename boundary is the commit point: a fully-written candidate is never authoritative on its own.
    const root = await mkdtemp(join(tmpdir(), "takode-model-provenance-atomic-"));
    tempRoots.push(root);
    const path = join(root, MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_FILENAME);
    const renameFailure = new Error("controlled rename failure");
    let failRename = false;
    const writer = (filePath: string, contents: string) =>
      replaceModelProvenanceMigrationAcknowledgementsAtomically(
        filePath,
        contents,
        failRename
          ? async () => {
              throw renameFailure;
            }
          : undefined,
      );
    const store = new ModelProvenanceMigrationAcknowledgementStore(path, writer);
    await store.load();
    await store.acknowledge("event-a", 123);
    const committedA = await readFile(path, "utf8");

    failRename = true;
    await expect(store.acknowledge("event-b", 456)).rejects.toBe(renameFailure);
    const candidatePath = modelProvenanceMigrationAcknowledgementTempPath(path);
    expect(JSON.parse(await readFile(candidatePath, "utf8")).acknowledgements).toEqual({
      "event-a": 123,
      "event-b": 456,
    });
    expect(await readFile(path, "utf8")).toBe(committedA);

    const afterFailure = new ModelProvenanceMigrationAcknowledgementStore(path);
    await afterFailure.load();
    expect(afterFailure.getAcknowledgedAt("event-a")).toBe(123);
    expect(afterFailure.getAcknowledgedAt("event-b")).toBeUndefined();
    expect(await readdir(root)).not.toContain(MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_TEMP_FILENAME);

    await afterFailure.acknowledge("event-b", 789);
    const restored = new ModelProvenanceMigrationAcknowledgementStore(path);
    await restored.load();
    expect(restored.getAcknowledgedAt("event-a")).toBe(123);
    expect(restored.getAcknowledgedAt("event-b")).toBe(789);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("serializes different events into incremental atomic replacements", async () => {
    // Each queued event builds from the last committed in-memory snapshot, preserving arrival order.
    const root = await mkdtemp(join(tmpdir(), "takode-model-provenance-order-"));
    tempRoots.push(root);
    const path = join(root, MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_FILENAME);
    const payloads: Array<Record<string, number>> = [];
    const writer = async (filePath: string, contents: string) => {
      payloads.push(JSON.parse(contents).acknowledgements);
      await replaceModelProvenanceMigrationAcknowledgementsAtomically(filePath, contents);
    };
    const store = new ModelProvenanceMigrationAcknowledgementStore(path, writer);
    await store.load();

    await Promise.all([
      store.acknowledge("event-a", 1),
      store.acknowledge("event-b", 2),
      store.acknowledge("event-c", 3),
    ]);

    expect(payloads).toEqual([
      { "event-a": 1 },
      { "event-a": 1, "event-b": 2 },
      { "event-a": 1, "event-b": 2, "event-c": 3 },
    ]);
    expect(JSON.parse(await readFile(path, "utf8")).acknowledgements).toEqual(payloads.at(-1));
  });

  it("loads the committed sidecar and removes only its owned stale candidate", async () => {
    // Simulate process interruption after candidate write but before rename; unrelated lookalikes must survive cleanup.
    const root = await mkdtemp(join(tmpdir(), "takode-model-provenance-stale-"));
    tempRoots.push(root);
    const path = join(root, MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_FILENAME);
    const initial = new ModelProvenanceMigrationAcknowledgementStore(path);
    await initial.load();
    await initial.acknowledge("event-a", 123);
    const candidatePath = modelProvenanceMigrationAcknowledgementTempPath(path);
    await writeFile(candidatePath, JSON.stringify({ version: 1, acknowledgements: { "event-b": 456 } }), {
      mode: 0o600,
    });
    const unrelatedPath = `${candidatePath}.unrelated`;
    await writeFile(unrelatedPath, "keep me", "utf8");

    const restored = new ModelProvenanceMigrationAcknowledgementStore(path);
    await restored.load();

    expect(restored.getAcknowledgedAt("event-a")).toBe(123);
    expect(restored.getAcknowledgedAt("event-b")).toBeUndefined();
    expect(await readdir(root)).not.toContain(MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_TEMP_FILENAME);
    expect(await readFile(unrelatedPath, "utf8")).toBe("keep me");
    expect(await readFile(path, "utf8")).toContain('"event-a": 123');
  });
});
