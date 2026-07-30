import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ModelProvenanceMigrationAcknowledgementStore } from "./model-provenance-migration-acknowledgement-store.js";

const tempRoots: string[] = [];

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
});
