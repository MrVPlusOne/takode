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

function activeRunDetails(linkedQuestId = "q-101") {
  return {
    linkedQuestId,
    expectedRunState: "active-obligation" as const,
    monitorRequirement: {
      cadenceMinutes: 15,
      requiredProductProof: "timer-or-hard-event" as const,
      stopConditionRequiresLeaderAction: true,
    },
    stopConditions: ["tmux-missing" as const, "lance-not-advancing" as const],
  };
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

  it("surfaces manual cleanup candidates through bookkeeping memory checks", async () => {
    await createWorkstream();
    await memoryStore.upsertRecord({
      ref: "takode-memory/active-route",
      bucket: "current",
      subtype: "route",
      priority: "important",
      current: "Use the temporary route until the foundation is accepted.",
      appliesTo: { exactTerms: ["route"] },
      evidence: source(),
      authorityBoundary: authority(),
      retireWhen: { description: "foundation is accepted or replaced" },
    });
    await memoryStore.upsertRecord({
      ref: "takode-memory/retired-note",
      bucket: "current",
      subtype: "decision",
      priority: "important",
      current: "Retire this record after it is no longer current.",
      appliesTo: { exactTerms: ["retired-note"] },
      evidence: source(),
      authorityBoundary: authority(),
    });
    await memoryStore.upsertRecord({
      ref: "takode-memory/superseded-note",
      bucket: "current",
      subtype: "decision",
      priority: "important",
      current: "Supersede this record after replacement.",
      appliesTo: { exactTerms: ["superseded-note"] },
      evidence: source(),
      authorityBoundary: authority(),
    });
    await memoryStore.retireRecord({
      ref: "takode-memory/retired-note",
      reason: "No longer current.",
      sourceLinks: source(),
    });
    await memoryStore.retireRecord({
      ref: "takode-memory/superseded-note",
      reason: "Replaced by a newer decision.",
      sourceLinks: source(),
      supersededBy: "takode-memory/newer-note",
    });

    // `memory check --event bookkeeping` should not look false-clean when foundation cleanup candidates exist.
    const result = await memoryStore.checkMemory({
      event: "bookkeeping",
      workstream: "takode-memory",
      callerState: { kind: "bookkeeping" },
    });

    expect(result.level).toBe("warn");
    expect(result.enforceable).toBe(false);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        record: "takode-memory/active-route",
        why: expect.arrayContaining([expect.stringContaining("retireWhen cleanup review candidate")]),
      }),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        record: "takode-memory/retired-note",
        why: expect.arrayContaining([expect.stringContaining("hidden retired record retained")]),
      }),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        record: "takode-memory/superseded-note",
        why: expect.arrayContaining([expect.stringContaining("hidden superseded record replaced")]),
      }),
    );
  });

  it("recalls scoped current context for approved memory check events", async () => {
    await createWorkstream();
    await memoryStore.linkWorkstream({
      workstream: "takode-memory",
      quests: [{ questId: "q-101", role: "deliverable" }],
    });
    await memoryStore.upsertRecord({
      ref: "takode-memory/dispatch-policy",
      bucket: "current",
      subtype: "policy",
      priority: "blocking",
      current: "Dispatch should include the accepted workstream memory summary.",
      appliesTo: { questIds: ["q-101"] },
      retrievalHooks: ["dispatch"],
      evidence: source(),
      authorityBoundary: authority(),
    });

    // This validates the hookable evaluator's baseline path: typed event in, scoped recall out.
    const result = await memoryStore.checkMemory({
      event: "dispatch",
      questId: "q-101",
      callerState: { kind: "dispatch", questId: "q-101" },
    });

    expect(result.status).toBe("ok");
    expect(result.level).toBe("recall");
    expect(result.records.map((record) => record.key)).toEqual(["dispatch-policy"]);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ level: "recall", record: "takode-memory/dispatch-policy" }),
    );
  });

  it("fails closed when memory check receives mismatched typed state", async () => {
    await createWorkstream();

    // Check state kind must match the explicit event so callers cannot smuggle freeform state.
    await expect(
      memoryStore.checkMemory({
        event: "dispatch",
        workstream: "takode-memory",
        callerState: { kind: "worker-prompt", questId: "q-101" },
      }),
    ).rejects.toThrow("does not match event dispatch");
  });

  it("gates long-running execute launches without active-run dossiers or monitor proof", async () => {
    await createWorkstream();
    await memoryStore.linkWorkstream({
      workstream: "takode-memory",
      quests: [{ questId: "q-101", role: "deliverable" }],
    });

    // Missing dossier is a gate finding, but not enforceable without trusted product adapter proof.
    const missingDossier = await memoryStore.checkMemory({
      event: "execute-launch",
      questId: "q-101",
      callerState: { kind: "execute-launch", questId: "q-101", longRunning: true },
    });

    expect(missingDossier.level).toBe("gate");
    expect(missingDossier.enforceable).toBe(false);
    expect(missingDossier.findings).toContainEqual(
      expect.objectContaining({ why: expect.arrayContaining([expect.stringContaining("no matching active-run")]) }),
    );

    await memoryStore.upsertRecord({
      ref: "takode-memory/active-run",
      bucket: "current",
      subtype: "active-run",
      priority: "safety",
      current: "q-101 must keep a 15m monitor until the long-running job is complete or stopped.",
      appliesTo: { questIds: ["q-101"] },
      retrievalHooks: ["execute-launch", "worker-turn-end", "recovery", "compaction"],
      evidence: source(),
      authorityBoundary: memoryStore.parseAuthorityBoundary(
        "expected active-run obligations|timer-store|product-state-overrides",
      ),
      retireWhen: { description: "q-101 run completes, stops, or is replaced" },
      activeRun: activeRunDetails(),
    });

    const missingProof = await memoryStore.checkMemory({
      event: "execute-launch",
      questId: "q-101",
      productState: { source: "product-adapter", trusted: true, proofs: [] },
      callerState: { kind: "execute-launch", questId: "q-101", longRunning: true },
      options: { enforce: true },
    });

    expect(missingProof.level).toBe("gate");
    expect(missingProof.enforceable).toBe(true);
    expect(missingProof.requiredActions).toContainEqual(expect.stringContaining("Create/prove a recurring monitor"));

    const callerSuppliedMonitorPlan = await memoryStore.checkMemory({
      event: "execute-launch",
      questId: "q-101",
      callerState: {
        kind: "execute-launch",
        questId: "q-101",
        longRunning: true,
        monitorPlan: { productProof: { kind: "timer", trusted: true } },
      },
      options: { enforce: true },
    });

    expect(callerSuppliedMonitorPlan.level).toBe("gate");
    expect(callerSuppliedMonitorPlan.enforceable).toBe(false);
    expect(callerSuppliedMonitorPlan.requiredActions).toContainEqual(
      expect.stringContaining("Create/prove a recurring monitor"),
    );

    const callerSuppliedProductState = await memoryStore.checkMemory({
      event: "execute-launch",
      questId: "q-101",
      productState: { source: "caller-supplied", trusted: true, proofs: [{ kind: "timer", trusted: true }] },
      callerState: { kind: "execute-launch", questId: "q-101", longRunning: true },
      options: { enforce: true },
    });

    expect(callerSuppliedProductState.level).toBe("gate");
    expect(callerSuppliedProductState.enforceable).toBe(false);
    expect(callerSuppliedProductState.requiredActions).toContainEqual(
      expect.stringContaining("Create/prove a recurring monitor"),
    );

    const untrustedProof = await memoryStore.checkMemory({
      event: "execute-launch",
      questId: "q-101",
      productState: {
        source: "product-adapter",
        trusted: true,
        proofs: [{ kind: "timer", trusted: false }],
      },
      callerState: { kind: "execute-launch", questId: "q-101", longRunning: true },
      options: { enforce: true },
    });

    expect(untrustedProof.level).toBe("gate");
    expect(untrustedProof.enforceable).toBe(true);
    expect(untrustedProof.requiredActions).toContainEqual(expect.stringContaining("Create/prove a recurring monitor"));

    const withProof = await memoryStore.checkMemory({
      event: "execute-launch",
      questId: "q-101",
      productState: { source: "product-adapter", trusted: true, proofs: [{ kind: "timer", trusted: true }] },
      callerState: { kind: "execute-launch", questId: "q-101", longRunning: true },
      options: { enforce: true },
    });

    expect(withProof.level).toBe("recall");
    expect(withProof.enforceable).toBe(false);
  });

  it("does not satisfy a quest-scoped active-run check with another linked quest's dossier", async () => {
    await createWorkstream();
    await memoryStore.linkWorkstream({
      workstream: "takode-memory",
      quests: [
        { questId: "q-101", role: "deliverable" },
        { questId: "q-102", role: "deliverable" },
      ],
    });
    await memoryStore.upsertRecord({
      ref: "takode-memory/q101-active-run",
      bucket: "current",
      subtype: "active-run",
      priority: "safety",
      current: "q-101 has a valid active-run dossier; q-102 does not.",
      appliesTo: { questIds: ["q-101"] },
      retrievalHooks: ["execute-launch", "worker-turn-end"],
      evidence: source(),
      authorityBoundary: memoryStore.parseAuthorityBoundary(
        "expected active-run obligations|timer-store|product-state-overrides",
      ),
      retireWhen: { description: "q-101 run completes, stops, or is replaced" },
      activeRun: activeRunDetails("q-101"),
    });

    // Generic execute-launch hooks on q-101's record must not hide q-102's missing-dossier gate.
    const result = await memoryStore.checkMemory({
      event: "execute-launch",
      questId: "q-102",
      productState: { source: "product-adapter", trusted: true, proofs: [{ kind: "timer" }] },
      callerState: { kind: "execute-launch", questId: "q-102", longRunning: true },
      options: { enforce: true },
    });

    expect(result.level).toBe("gate");
    expect(result.enforceable).toBe(true);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ why: expect.arrayContaining([expect.stringContaining("no matching active-run")]) }),
    );
    expect(result.findings).not.toContainEqual(
      expect.objectContaining({
        why: expect.arrayContaining([expect.stringContaining("trusted monitor timer or worker-hard-event proof")]),
      }),
    );
  });

  it("gates unreported active-run stop signals from trusted worker turn-end evidence", async () => {
    await createWorkstream();
    await memoryStore.upsertRecord({
      ref: "takode-memory/active-run",
      bucket: "current",
      subtype: "active-run",
      priority: "safety",
      current: "Stop-condition reports for q-101 must wake the leader before continuation.",
      appliesTo: { questIds: ["q-101"] },
      retrievalHooks: ["worker-turn-end"],
      evidence: source(),
      authorityBoundary: memoryStore.parseAuthorityBoundary(
        "active-run stop-condition policy|phase-notes|block-until-resolved",
      ),
      retireWhen: { description: "q-101 run completes, stops, or is replaced" },
      activeRun: activeRunDetails(),
    });

    // A trusted product path can make the stop-condition gate enforceable; caller-only evidence cannot.
    const result = await memoryStore.checkMemory({
      event: "worker-turn-end",
      workstream: "takode-memory",
      productState: { source: "product-adapter", trusted: true },
      callerState: {
        kind: "worker-turn-end",
        questId: "q-101",
        summarySignals: ["tmux-missing"],
        reportedToUser: false,
        trusted: true,
      },
      options: { enforce: true },
    });

    expect(result.level).toBe("gate");
    expect(result.enforceable).toBe(true);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ why: expect.arrayContaining([expect.stringContaining("tmux-missing")]) }),
    );
  });

  it("warns rather than owning live product state during bookkeeping checks", async () => {
    await createWorkstream();
    await memoryStore.upsertRecord({
      ref: "takode-memory/live-endpoint",
      bucket: "current",
      subtype: "mission",
      priority: "important",
      current: "The live endpoint is currently running on port 3456.",
      appliesTo: { exactTerms: ["endpoint"] },
      retrievalHooks: ["bookkeeping"],
      evidence: source(),
      authorityBoundary: memoryStore.parseAuthorityBoundary(
        "expected endpoint policy|product-state|product-state-overrides",
      ),
    });

    // Product-state-like memory is surfaced as a warning; the evaluator does not treat it as live truth.
    const result = await memoryStore.checkMemory({
      event: "bookkeeping",
      workstream: "takode-memory",
      callerState: { kind: "bookkeeping", terms: ["endpoint"] },
    });

    expect(result.level).toBe("warn");
    expect(result.enforceable).toBe(false);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ why: expect.arrayContaining([expect.stringContaining("live product state")]) }),
    );
  });
});
