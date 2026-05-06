import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempDir: string;
let memoryStore: typeof import("./workstream-memory-store.js");

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "workstream-memory-test-"));
  process.env.COMPANION_WORKSTREAM_MEMORY_DIR = join(tempDir, "memory");
  vi.resetModules();
  memoryStore = await import("./workstream-memory-store.js");
});

afterEach(async () => {
  delete process.env.COMPANION_WORKSTREAM_MEMORY_DIR;
  await rm(tempDir, { recursive: true, force: true });
});

function source() {
  return [memoryStore.parseSourceLink("[q-100](quest:q-100)")];
}

function authority() {
  return memoryStore.parseAuthorityBoundary("memory owns current policy|quest|user-overrides");
}

async function createWorkstream() {
  return memoryStore.createWorkstream({
    slug: "takode-memory",
    title: "Takode memory",
    objective: "Preserve current memory decisions.",
    scopeTags: ["takode", "memory"],
    sourceLinks: source(),
  });
}

describe("workstream memory store", () => {
  it("persists workstreams and linked quests as structured Markdown", async () => {
    await createWorkstream();
    const linked = await memoryStore.linkWorkstream({
      workstream: "takode-memory",
      quests: [{ questId: "q-101", role: "deliverable", label: "foundation" }],
    });

    expect(linked.linkedQuests).toEqual([
      expect.objectContaining({ questId: "q-101", role: "deliverable", label: "foundation" }),
    ]);

    const raw = await readFile(join(tempDir, "memory", "workstreams", "takode-memory.md"), "utf-8");
    expect(raw).toContain("---\n");
    expect(raw).toContain('slug: "takode-memory"');
    expect(raw).toContain("# Takode memory");
    expect(raw).toContain("Preserve current memory decisions.");
  });

  it("upserts current records and returns matching current context by linked quest", async () => {
    await createWorkstream();
    await memoryStore.linkWorkstream({
      workstream: "takode-memory",
      quests: [{ questId: "q-101", role: "deliverable" }],
    });
    const record = await memoryStore.upsertRecord({
      ref: "takode-memory/current-model",
      bucket: "current",
      subtype: "decision",
      priority: "blocking",
      title: "Visible model",
      current: "Use Current Context and Reference Pointer buckets.",
      appliesTo: { questIds: ["q-101"] },
      retrievalHooks: ["alignment"],
      evidence: source(),
      authorityBoundary: authority(),
    });

    expect(record.history).toHaveLength(1);
    const result = await memoryStore.readCurrentContext({ questId: "q-101", purpose: "alignment" });
    expect(result.records.map((item) => item.key)).toEqual(["current-model"]);
    expect(result.records[0]?.current).toContain("Reference Pointer");
  });

  it("updates exact record keys in place and preserves version history", async () => {
    await createWorkstream();
    await memoryStore.upsertRecord({
      ref: "takode-memory/current-model",
      bucket: "current",
      subtype: "decision",
      priority: "important",
      current: "Old decision.",
      appliesTo: { exactTerms: ["memory"] },
      evidence: source(),
      authorityBoundary: authority(),
    });

    const updated = await memoryStore.upsertRecord({
      ref: "takode-memory/current-model",
      bucket: "current",
      subtype: "decision",
      priority: "blocking",
      current: "New accepted decision.",
      appliesTo: { exactTerms: ["memory"] },
      evidence: [memoryStore.parseSourceLink("[checkpoint](quest:q-100#26)")],
      authorityBoundary: authority(),
    });

    expect(updated.id).toBe((await memoryStore.getRecord("takode-memory/current-model"))?.id);
    expect(updated.history.map((version) => version.current)).toEqual(["Old decision.", "New accepted decision."]);
    expect(updated.evidence.map((item) => item.target)).toContain("quest:q-100#26");
  });

  it("validates active record source, reference targets, and temporary retire conditions", async () => {
    await createWorkstream();
    await expect(
      memoryStore.upsertRecord({
        ref: "takode-memory/no-source",
        bucket: "current",
        subtype: "decision",
        priority: "important",
        current: "Missing source.",
        appliesTo: { exactTerms: ["memory"] },
        evidence: [],
        authorityBoundary: authority(),
      }),
    ).rejects.toThrow("Active memory records require at least one source");

    await expect(
      memoryStore.upsertRecord({
        ref: "takode-memory/reference",
        bucket: "reference",
        subtype: "report-pointer",
        priority: "info",
        current: "Read accepted report.",
        appliesTo: { exactTerms: ["memory"] },
        evidence: source(),
        authorityBoundary: authority(),
      }),
    ).rejects.toThrow("Reference Pointer records require a target");

    await expect(
      memoryStore.upsertRecord({
        ref: "takode-memory/route",
        bucket: "current",
        subtype: "route",
        priority: "important",
        current: "Temporary route.",
        appliesTo: { exactTerms: ["memory"] },
        evidence: source(),
        authorityBoundary: authority(),
      }),
    ).rejects.toThrow("route records require retireWhen");
  });

  it("searches active records by content and hides retired records by default", async () => {
    await createWorkstream();
    await memoryStore.upsertRecord({
      ref: "takode-memory/worksheet",
      bucket: "reference",
      subtype: "report-pointer",
      priority: "info",
      current: "Implementation worksheet for memory CLI behavior.",
      target: {
        kind: "file",
        target: "file:docs/workstream-memory-worksheet.md",
        label: "worksheet",
      },
      appliesTo: { exactTerms: ["worksheet"] },
      evidence: source(),
      authorityBoundary: authority(),
    });

    expect((await memoryStore.searchRecords({ pattern: "worksheet" })).map((result) => result.record.key)).toEqual([
      "worksheet",
    ]);
    await memoryStore.retireRecord({
      ref: "takode-memory/worksheet",
      reason: "Moved to accepted design record.",
      sourceLinks: source(),
    });
    expect(await memoryStore.searchRecords({ pattern: "worksheet" })).toEqual([]);
    expect(
      (await memoryStore.searchRecords({ pattern: "worksheet", includeRetired: true })).map(
        (result) => result.record.status,
      ),
    ).toEqual(["retired"]);
  });

  it("hides archived workstreams from default list and all-workstream search", async () => {
    await createWorkstream();
    await memoryStore.upsertRecord({
      ref: "takode-memory/current-model",
      bucket: "current",
      subtype: "decision",
      priority: "important",
      current: "Archived workstream content should not appear by default.",
      appliesTo: { exactTerms: ["archive-default"] },
      evidence: source(),
      authorityBoundary: authority(),
    });

    await memoryStore.archiveWorkstream("takode-memory");

    expect(await memoryStore.listWorkstreams()).toEqual([]);
    expect(await memoryStore.searchRecords({ pattern: "archive-default" })).toEqual([]);
    expect((await memoryStore.searchRecords({ pattern: "archive-default", workstream: "takode-memory" })).length).toBe(
      1,
    );
  });

  it("rejects duplicate slugs even after a workstream is archived", async () => {
    const original = await createWorkstream();

    await memoryStore.archiveWorkstream("takode-memory");

    await expect(
      memoryStore.createWorkstream({
        slug: "takode-memory",
        title: "Replacement",
        objective: "This must not overwrite archived history.",
        sourceLinks: source(),
      }),
    ).rejects.toThrow("Workstream slug already exists: takode-memory");

    const archived = await memoryStore.getWorkstream("takode-memory", { includeArchived: true });
    expect(archived).toEqual(expect.objectContaining({ id: original.id, status: "archived" }));
  });

  it("requires explicit reactivation before superseded records can be updated", async () => {
    await createWorkstream();
    await memoryStore.upsertRecord({
      ref: "takode-memory/decision",
      bucket: "current",
      subtype: "decision",
      priority: "important",
      current: "Use the first accepted decision.",
      appliesTo: { exactTerms: ["decision"] },
      evidence: source(),
      authorityBoundary: authority(),
    });
    await memoryStore.retireRecord({
      ref: "takode-memory/decision",
      reason: "Replaced by a newer decision record.",
      sourceLinks: source(),
      supersededBy: "takode-memory/decision-v2",
    });

    await expect(
      memoryStore.upsertRecord({
        ref: "takode-memory/decision",
        bucket: "current",
        subtype: "decision",
        priority: "important",
        current: "Ordinary upsert must not reactivate hidden history.",
        appliesTo: { exactTerms: ["decision"] },
        evidence: source(),
        authorityBoundary: authority(),
      }),
    ).rejects.toThrow("Record is superseded; pass --reactivate");

    const hidden = await memoryStore.getRecord("takode-memory/decision", { includeRetired: true });
    expect(hidden).toEqual(expect.objectContaining({ status: "superseded", replacedBy: "takode-memory/decision-v2" }));

    const reactivated = await memoryStore.upsertRecord({
      ref: "takode-memory/decision",
      bucket: "current",
      subtype: "decision",
      priority: "important",
      current: "Explicitly reactivated decision.",
      appliesTo: { exactTerms: ["decision"] },
      evidence: source(),
      authorityBoundary: authority(),
      reactivate: true,
    });
    expect(reactivated).toEqual(expect.objectContaining({ status: "active", replacedBy: undefined }));
  });

  it("includes superseded hidden records in bookkeeping maintenance reports", async () => {
    await createWorkstream();
    await memoryStore.upsertRecord({
      ref: "takode-memory/decision",
      bucket: "current",
      subtype: "decision",
      priority: "important",
      current: "Use the old decision until replaced.",
      appliesTo: { exactTerms: ["decision"] },
      evidence: source(),
      authorityBoundary: authority(),
    });
    await memoryStore.retireRecord({
      ref: "takode-memory/decision",
      reason: "Replaced by a newer decision record.",
      sourceLinks: source(),
      supersededBy: "takode-memory/decision-v2",
    });

    const report = await memoryStore.bookkeepingReport("takode-memory");

    expect(report.issues).toContainEqual(
      expect.objectContaining({
        level: "info",
        record: "takode-memory/decision",
        message: expect.stringContaining("hidden superseded record replaced by takode-memory/decision-v2"),
      }),
    );
  });

  it("surfaces retireWhen records as manual bookkeeping cleanup candidates", async () => {
    await createWorkstream();
    await memoryStore.upsertRecord({
      ref: "takode-memory/active-route",
      bucket: "current",
      subtype: "route",
      priority: "important",
      current: "Use the temporary implementation route until the foundation lands.",
      appliesTo: { exactTerms: ["route"] },
      evidence: source(),
      authorityBoundary: authority(),
      retireWhen: { description: "foundation is accepted or replaced" },
    });

    const report = await memoryStore.bookkeepingReport("takode-memory");

    expect(report.issues).toContainEqual(
      expect.objectContaining({
        level: "info",
        record: "takode-memory/active-route",
        message: expect.stringContaining("retireWhen cleanup review candidate"),
      }),
    );
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        record: "takode-memory/active-route",
        message: expect.stringContaining("Expiry evaluation is manual"),
      }),
    );
  });

  it("reports bookkeeping warnings for product-state-like current records", async () => {
    await createWorkstream();
    await memoryStore.upsertRecord({
      ref: "takode-memory/live-pid",
      bucket: "current",
      subtype: "mission",
      priority: "info",
      current: "The live endpoint is currently running on port 3456.",
      appliesTo: { exactTerms: ["endpoint"] },
      evidence: source(),
      authorityBoundary: authority(),
    });

    const report = await memoryStore.bookkeepingReport("takode-memory");
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        record: "takode-memory/live-pid",
        message: expect.stringContaining("live product state"),
      }),
    );
  });
});
