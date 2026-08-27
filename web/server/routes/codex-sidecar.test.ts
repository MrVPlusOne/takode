import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexSidecarRegistry } from "../codex-sidecar-auth.js";
import { TodoStore } from "../todo-store.js";
import type { QuestmasterTask } from "../quest-types.js";
import type { RouteContext } from "./context.js";
import { createCodexSidecarRoutes, type CodexSidecarRouteDependencies } from "./codex-sidecar.js";

const CAPABILITY = "test-sidecar-capability";
let root: string;
let todoStore: TodoStore;
let app: Hono;
let registry: CodexSidecarRegistry;
let optionalCaller: any = null;
let boardRow: unknown = null;
let quests: QuestmasterTask[];
const broadcastGlobal = vi.fn();
const memoryRecall = vi.fn();
const memoryRead = vi.fn();
const getLeaseStatus = vi.fn();
const questClaim = vi.fn();

beforeEach(async () => {
  // Every durable store used by these tests lives under a disposable temp root.
  root = mkdtempSync(join(tmpdir(), "takode-codex-sidecar-route-"));
  todoStore = new TodoStore(join(root, "todos.json"));
  registry = new CodexSidecarRegistry({ port: 4567, serverId: "server-test", capability: CAPABILITY });
  await registry.initialize();
  optionalCaller = null;
  boardRow = null;
  quests = [];
  broadcastGlobal.mockReset();
  memoryRecall.mockReset().mockResolvedValue({ repo: { root }, matches: [], issues: [] });
  memoryRead.mockReset().mockResolvedValue({ repo: { root }, file: { path: "knowledge/example.md", content: "body" } });
  getLeaseStatus
    .mockReset()
    .mockResolvedValue({ resourceKey: "dev-server:test", lease: null, waiters: [], available: true });
  questClaim.mockReset().mockImplementation(async (questId: string, sessionId: string, options: any) => {
    const current = quests.find((quest) => quest.questId === questId);
    if (!current) return null;
    const claimed = {
      ...current,
      status: "in_progress",
      description: "Claimed description",
      sessionId,
      ownerKind: options.ownerKind,
      claimedAt: 200,
      lastModifiedBy: options.provenance,
    } as QuestmasterTask;
    quests = quests.map((quest) => (quest.questId === questId ? claimed : quest));
    return claimed;
  });

  const questStore = {
    listQuests: async () => quests,
    getQuest: async (questId: string) => quests.find((quest) => quest.questId === questId) ?? null,
    createQuest: async (input: any) => {
      const quest = {
        id: `q-${quests.length + 1}`,
        questId: `q-${quests.length + 1}`,
        version: 1,
        title: input.title,
        description: input.description,
        status: "idea",
        createdAt: 100,
        createdBy: input.createdBy,
        lastModifiedBy: input.lastModifiedBy,
      } as QuestmasterTask;
      quests.push(quest);
      return quest;
    },
    patchQuest: async (questId: string, patch: any) => {
      const current = quests.find((quest) => quest.questId === questId);
      if (!current) return null;
      const updated = { ...current, ...patch, updatedAt: 150 } as QuestmasterTask;
      quests = quests.map((quest) => (quest.questId === questId ? updated : quest));
      return updated;
    },
    patchQuestForOwner: async (questId: string, owner: any, patch: any) => {
      const current = quests.find((quest) => quest.questId === questId);
      if (!current) return null;
      if (current.status === "in_progress") {
        const currentKind = current.ownerKind ?? "takode";
        if (currentKind !== owner.kind || current.sessionId !== owner.sessionId) {
          throw new Error(`Quest ${questId} is owned by ${currentKind} owner ${current.sessionId}`);
        }
      }
      const updated = { ...current, ...patch, updatedAt: 150 } as QuestmasterTask;
      quests = quests.map((quest) => (quest.questId === questId ? updated : quest));
      return updated;
    },
    appendQuestFeedback: async (questId: string, entry: any, options: any) => {
      const current = quests.find((quest) => quest.questId === questId);
      if (!current) return null;
      const updated = {
        ...current,
        feedback: [...(current.feedback ?? []), entry],
        lastModifiedBy: options?.lastModifiedBy,
        updatedAt: 150,
      } as QuestmasterTask;
      quests = quests.map((quest) => (quest.questId === questId ? updated : quest));
      return updated;
    },
    claimQuest: questClaim,
    transitionQuest: async (questId: string, input: any) => {
      const current = quests.find((quest) => quest.questId === questId);
      if (!current) return null;
      const updated = {
        ...current,
        ...input,
        status: input.status,
        completedAt: 300,
        verificationItems: input.verificationItems ?? [],
      } as QuestmasterTask;
      delete (updated as any).sessionId;
      quests = quests.map((quest) => (quest.questId === questId ? updated : quest));
      return updated;
    },
    cancelQuestForOwner: async (questId: string, owner: any, notes: string | undefined, options: any) => {
      const current = quests.find((quest) => quest.questId === questId);
      if (!current) return null;
      if (current.status === "in_progress") {
        const currentKind = current.ownerKind ?? "takode";
        if (currentKind !== owner.kind || current.sessionId !== owner.sessionId) {
          throw new Error(`Quest ${questId} is owned by ${currentKind} owner ${current.sessionId}`);
        }
      }
      const updated = {
        ...current,
        status: "done",
        cancelled: true,
        notes,
        verificationItems: [],
        completedAt: 300,
        lastModifiedBy: options.provenance,
      } as QuestmasterTask;
      quests = quests.map((quest) => (quest.questId === questId ? updated : quest));
      return updated;
    },
  } as CodexSidecarRouteDependencies["questStore"];

  const ctx = {
    launcher: { listSessions: () => [{ sessionId: "leader-1" }] },
    wsBridge: {
      broadcastGlobal,
      getBoardRow: () => boardRow,
    },
    resourceLeaseManager: { getStatus: getLeaseStatus },
    authenticateCompanionCallerOptional: () => optionalCaller,
    options: { codexSidecarRegistry: registry },
  } as unknown as RouteContext;
  app = new Hono();
  app.route(
    "/",
    createCodexSidecarRoutes(ctx, {
      registry,
      todoStore,
      questStore,
      memoryService: { recall: memoryRecall, readRecord: memoryRead },
      now: () => 123,
    }),
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("Codex sidecar routes", () => {
  it("requires server-observed loopback and the per-install capability", async () => {
    // A caller-controlled task id is accepted only after the local transport is classified.
    expect((await request("/integrations/codex/quests/search", { clientIp: "192.0.2.1" })).status).toBe(403);
    expect(
      (
        await request("/integrations/codex/quests/search", {
          clientIp: "127.0.0.1",
          capability: "wrong",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/integrations/codex/quests/search", {
          clientIp: "127.0.0.1",
          capability: CAPABILITY,
        })
      ).status,
    ).toBe(200);
  });

  it("binds a Codex task and performs a direct Todo mutation with authoritative provenance", async () => {
    // Plugin writes bypass prompt/grant ceremony but retain store validation and attribution.
    const binding = await bindCodexActor();
    const response = await request("/integrations/codex/todos", {
      method: "POST",
      binding,
      body: { markdown: "Review the sidecar result" },
    });
    expect(response.status).toBe(201);
    const item = (await response.json()).item;
    expect(item.createdBy).toMatchObject({
      actor: { kind: "session", provider: "codex", sessionId: "thr-123" },
      authorization: { kind: "agent_direct" },
      at: 123,
    });
    expect(broadcastGlobal).toHaveBeenCalledTimes(1);
    expect(broadcastGlobal).toHaveBeenCalledWith(expect.objectContaining({ type: "todo_state_updated", revision: 1 }));
  });

  it("does not let a capability holder bind an unverified Takode identity", async () => {
    const response = await request("/integrations/codex/bind", {
      method: "POST",
      body: { actor: { kind: "takode_session", sessionId: "spoofed-worker" } },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Only verified Companion credentials can bind a Takode session identity",
    });
  });

  it("uses explicit valid Companion identity before an external binding", async () => {
    // Managed sessions keep their Takode identity and do not need a sidecar binding.
    optionalCaller = { callerId: "takode-worker", caller: { sessionId: "takode-worker" } };
    const response = await request("/integrations/codex/todos", {
      method: "POST",
      body: { markdown: "Managed write", actor: { kind: "codex_session", sessionId: "spoofed" } },
    });
    expect(response.status).toBe(201);
    expect((await response.json()).item.createdBy.actor).toMatchObject({
      provider: "takode",
      sessionId: "takode-worker",
    });
  });

  it("keeps managed Takode Quest mutations on the existing workflow", async () => {
    // Sidecar Quest writes intentionally skip Takode session naming, task
    // history, Journey inference, and board cleanup, so managed actors must
    // continue through the existing authenticated Quest routes.
    optionalCaller = { callerId: "takode-worker", caller: { sessionId: "takode-worker" } };

    const response = await request("/integrations/codex/quests", {
      method: "POST",
      body: { title: "Do not bypass Takode workflow" },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Takode-managed sessions must use the existing Quest workflow" });
    expect(quests).toEqual([]);
  });

  it("creates, edits, and appends a flat Quest note with one invalidation per mutation", async () => {
    // Sidecar content writes record Codex invocation provenance without phase/Journey inference.
    const createdResponse = await codexRequest("/integrations/codex/quests", {
      method: "POST",
      body: { title: "Capture sidecar decision", description: "Durable documentation" },
    });
    const created = (await createdResponse.json()).quest;
    expect(createdResponse.status).toBe(201);

    const editResponse = await codexRequest(`/integrations/codex/quests/${created.questId}`, {
      method: "PATCH",
      body: { tldr: "Sidecar decision recorded" },
    });
    expect(editResponse.status).toBe(200);

    const noteResponse = await codexRequest(`/integrations/codex/quests/${created.questId}/notes`, {
      method: "POST",
      body: { text: "The app-owned Codex task recorded this note." },
    });
    expect(noteResponse.status).toBe(201);
    const note = (await noteResponse.json()).note;
    expect(note).toMatchObject({
      author: "agent",
      kind: "comment",
      provenance: { owner: { kind: "codex", sessionId: "thr-123" }, recordedAt: 123 },
    });
    expect(note.phaseId).toBeUndefined();
    expect(broadcastGlobal).toHaveBeenCalledTimes(3);
    expect(broadcastGlobal).toHaveBeenLastCalledWith({ type: "quest_list_updated" });
  });

  it("cannot edit a same-ID Takode owner but can edit the exact Codex owner", async () => {
    // The provider is part of owner identity. A matching raw ID must not let a
    // direct Codex task bypass Takode naming/task-history workflow.
    const created = (
      await (
        await codexRequest("/integrations/codex/quests", {
          method: "POST",
          body: { title: "Owner-guarded edit", description: "Original" },
        })
      ).json()
    ).quest;
    quests = quests.map((quest) =>
      quest.questId === created.questId
        ? ({
            ...quest,
            status: "in_progress",
            description: "Original",
            sessionId: "thr-123",
            claimedAt: 200,
          } as QuestmasterTask)
        : quest,
    );

    const rejected = await codexRequest(`/integrations/codex/quests/${created.questId}`, {
      method: "PATCH",
      body: { description: "Spoofed edit" },
    });
    expect(rejected.status).toBe(409);
    expect(quests[0]).toMatchObject({ description: "Original", sessionId: "thr-123" });

    quests = quests.map((quest) =>
      quest.questId === created.questId ? ({ ...quest, ownerKind: "codex" } as QuestmasterTask) : quest,
    );
    const accepted = await codexRequest(`/integrations/codex/quests/${created.questId}`, {
      method: "PATCH",
      body: { description: "Owned edit" },
    });
    expect(accepted.status).toBe(200);
    expect(quests[0]).toMatchObject({ description: "Owned edit", ownerKind: "codex", sessionId: "thr-123" });
  });

  it("cannot cancel a same-ID Takode owner but can cancel the exact Codex owner", async () => {
    // Cancellation performs this provider-aware check in the same store
    // mutation as the write, so a raw ID match is never sufficient authority.
    const created = (
      await (
        await codexRequest("/integrations/codex/quests", {
          method: "POST",
          body: { title: "Owner-guarded cancellation", description: "Original" },
        })
      ).json()
    ).quest;
    quests = quests.map((quest) =>
      quest.questId === created.questId
        ? ({
            ...quest,
            status: "in_progress",
            sessionId: "thr-123",
            claimedAt: 200,
          } as QuestmasterTask)
        : quest,
    );

    const rejected = await codexRequest(`/integrations/codex/quests/${created.questId}/cancel`, {
      method: "POST",
      body: { notes: "Must not cancel Takode work" },
    });
    expect(rejected.status).toBe(409);
    expect(quests[0]).toMatchObject({ status: "in_progress", sessionId: "thr-123" });

    quests = quests.map((quest) =>
      quest.questId === created.questId ? ({ ...quest, ownerKind: "codex" } as QuestmasterTask) : quest,
    );
    const accepted = await codexRequest(`/integrations/codex/quests/${created.questId}/cancel`, {
      method: "POST",
      body: { notes: "Direct owner cancelled it" },
    });
    expect(accepted.status).toBe(200);
    expect(quests[0]).toMatchObject({ status: "done", cancelled: true });
  });

  it("reveals full durable notes only through a bounded explicit page", async () => {
    const longText = `First full note ${"x".repeat(800)}`;
    quests = [
      {
        id: "q-7",
        questId: "q-7",
        version: 1,
        title: "Paged documentation",
        status: "done",
        description: "Completed documentation record.",
        createdAt: 1,
        updatedAt: 2,
        statusChangedAt: 9,
        completedAt: 9,
        verificationItems: [],
        notes: "Closure summary",
        feedback: Array.from({ length: 6 }, (_, index) => ({
          author: "agent" as const,
          text: index === 0 ? longText : `Note ${index}`,
          ts: index + 1,
        })),
      },
    ];

    const compact = (await (await request("/integrations/codex/quests/q-7")).json()).quest;
    expect(compact.notes).toBe("Closure summary");
    expect(compact.noteEntries).toBeUndefined();
    expect(compact.updatedAt).toBe(9);
    expect(compact.latestNotes).toHaveLength(5);
    expect(compact.latestNotes[0].index).toBe(1);

    const expanded = (await (await request("/integrations/codex/quests/q-7?noteOffset=0&noteLimit=1")).json()).quest;
    expect(expanded.notes).toBe("Closure summary");
    expect(expanded.noteEntries).toEqual([expect.objectContaining({ index: 0, text: longText })]);
    expect(expanded.nextNoteOffset).toBe(1);
  });

  it("rejects direct Codex claims while any active board row exists", async () => {
    // Proposed and queued rows remain in the active board map, so all rows block this bypass path.
    const created = (
      await (
        await codexRequest("/integrations/codex/quests", {
          method: "POST",
          body: { title: "Board-owned quest", description: "Do not steal" },
        })
      ).json()
    ).quest;
    broadcastGlobal.mockClear();
    boardRow = { questId: created.questId, status: "PROPOSED", createdAt: 1, updatedAt: 1 };

    const rejected = await codexRequest(`/integrations/codex/quests/${created.questId}/claim`, {
      method: "POST",
      body: {},
    });
    expect(rejected.status).toBe(409);
    expect(questClaim).not.toHaveBeenCalled();
    expect(broadcastGlobal).not.toHaveBeenCalled();

    const rejectedEdit = await codexRequest(`/integrations/codex/quests/${created.questId}`, {
      method: "PATCH",
      body: { title: "Do not bypass the board" },
    });
    const rejectedCancel = await codexRequest(`/integrations/codex/quests/${created.questId}/cancel`, {
      method: "POST",
      body: {},
    });
    expect(rejectedEdit.status).toBe(409);
    expect(rejectedCancel.status).toBe(409);
    expect(broadcastGlobal).not.toHaveBeenCalled();

    boardRow = null;
    const accepted = await codexRequest(`/integrations/codex/quests/${created.questId}/claim`, {
      method: "POST",
      body: {},
    });
    expect(accepted.status).toBe(200);
    expect(questClaim).toHaveBeenCalledWith(
      created.questId,
      "thr-123",
      expect.objectContaining({ ownerKind: "codex" }),
    );
    expect(broadcastGlobal).toHaveBeenCalledTimes(1);
  });

  it("lets the direct Codex owner complete and cancel without Takode session side effects", async () => {
    // Lifecycle writes use provider-aware store ownership and only broadcast the
    // authoritative Quest invalidation; they never invoke naming/task-history hooks.
    const first = (
      await (
        await codexRequest("/integrations/codex/quests", {
          method: "POST",
          body: { title: "Complete direct quest", description: "Complete directly" },
        })
      ).json()
    ).quest;
    await codexRequest(`/integrations/codex/quests/${first.questId}/claim`, { method: "POST", body: {} });
    broadcastGlobal.mockClear();

    const incomplete = await codexRequest(`/integrations/codex/quests/${first.questId}/complete`, {
      method: "POST",
      body: {},
    });
    expect(incomplete.status).toBe(400);
    expect(broadcastGlobal).not.toHaveBeenCalled();

    const completed = await codexRequest(`/integrations/codex/quests/${first.questId}/complete`, {
      method: "POST",
      body: { debrief: "Recorded outcome", debriefTldr: "Outcome recorded" },
    });
    expect(completed.status).toBe(200);
    expect((await completed.json()).quest).toMatchObject({
      status: "done",
      debrief: "Recorded outcome",
      lastModifiedBy: { owner: { kind: "codex", sessionId: "thr-123" }, recordedAt: 123 },
    });
    expect(broadcastGlobal).toHaveBeenCalledTimes(1);

    const second = (
      await (
        await codexRequest("/integrations/codex/quests", {
          method: "POST",
          body: { title: "Cancel direct quest", description: "Cancel directly" },
        })
      ).json()
    ).quest;
    broadcastGlobal.mockClear();
    const cancelled = await codexRequest(`/integrations/codex/quests/${second.questId}/cancel`, {
      method: "POST",
      body: { notes: "No longer needed" },
    });
    expect(cancelled.status).toBe(200);
    expect((await cancelled.json()).quest).toMatchObject({ status: "done", cancelled: true });
    expect(broadcastGlobal).toHaveBeenCalledTimes(1);
  });

  it("keeps Memory read-only and leases status-only", async () => {
    // The first slice must not create Memory repositories or mutate shared leases.
    const memory = await request("/integrations/codex/memory/recall?q=sidecar&limit=5");
    expect(memory.status).toBe(200);
    expect(memoryRecall).toHaveBeenCalledWith(
      { query: "sidecar", limit: 5, includeContent: false },
      { readOnly: true },
    );
    expect(memoryRead).not.toHaveBeenCalled();

    const lease = await request("/integrations/codex/leases/dev-server%3Atest");
    expect(lease.status).toBe(200);
    expect(getLeaseStatus).toHaveBeenCalledWith("dev-server:test");
  });
});

async function bindCodexActor(): Promise<string> {
  const response = await request("/integrations/codex/bind", {
    method: "POST",
    body: {
      actor: {
        kind: "codex_session",
        sessionId: "thr-123",
        turnId: "turn-1",
        toolUseId: "tool-1",
        cwd: "/repo",
      },
    },
  });
  expect(response.status).toBe(201);
  return (await response.json()).binding.id;
}

async function codexRequest(path: string, options: { method: string; body: unknown }): Promise<Response> {
  return request(path, { ...options, binding: await bindCodexActor() });
}

async function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    binding?: string;
    capability?: string;
    clientIp?: string;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.clientIp !== undefined) headers["x-companion-client-ip"] = options.clientIp;
  else if (options.capability === undefined) headers["x-companion-client-ip"] = "127.0.0.1";
  headers["x-takode-sidecar-capability"] = options.capability ?? CAPABILITY;
  if (options.binding) headers["x-takode-sidecar-binding"] = options.binding;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}
