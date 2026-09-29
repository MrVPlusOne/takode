import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as questStore from "./quest-store.js";
import { resolveQuestFeedbackDocumentation } from "./quest-phase-docs.js";
import type { QuestmasterTask } from "./quest-types.js";
import { validateCompanionAuth } from "./routes/auth.js";
import { createQuestRoutes, validateV2CompletionGitState } from "./routes/quests.js";

// Keep all durable writes behind mocks; exercise real routes, auth, phase routing,
// and the git-refresh controller using only in-memory sessions and quest records.
vi.mock("./quest-store.js");

const mockExecSync = vi.hoisted(() => vi.fn((_cmd?: string) => "" as any));
vi.mock("node:child_process", () => {
  // exec mock: callback-based, delegates to execSync for consistent test behavior.
  // Attaches stdout/stderr to the error object so promisify(exec) can find them,
  // matching Node's custom exec promisify behavior.
  const execMock = vi.fn((...args: any[]) => {
    const cmd = args[0] as string;
    const callback = typeof args[1] === "function" ? args[1] : args[2];
    try {
      const result = mockExecSync(cmd);
      if (callback) callback(null, { stdout: result ?? "", stderr: "" });
    } catch (err) {
      const e = err as any;
      if (e.stdout === undefined) e.stdout = "";
      if (e.stderr === undefined) e.stderr = "";
      if (callback) callback(err, { stdout: e.stdout ?? "", stderr: e.stderr ?? "" });
    }
  });
  const execFileMock = vi.fn((...args: any[]) => {
    const callback = args.find((arg) => typeof arg === "function");
    if (callback) callback(null, { stdout: "", stderr: "" });
  });
  return { execSync: mockExecSync, exec: execMock, execFile: execFileMock };
});

function createMockLauncher() {
  return {
    listSessions: vi.fn(() => []),
    getSession: vi.fn(),
    verifySessionAuthToken: vi.fn(() => true),
    resolveSessionId: vi.fn((id: string) => id),
  } as any;
}

function createMockBridge() {
  return {
    _sessions: {} as Record<string, any>,
    _gitStateDeps: {
      refreshGitInfo: vi.fn(async () => {}),
      broadcastSessionUpdate: vi.fn(),
      broadcastDiffTotals: vi.fn(),
      persistSession: vi.fn(),
    },
    getSession: vi.fn(function (this: any, sessionId: string) {
      return this._sessions[sessionId] ?? null;
    }),
    getSessionGitStateDeps: vi.fn(function (this: any) {
      return this._gitStateDeps;
    }),
    refreshWorktreeGitStateForSnapshot: vi.fn(async () => null),
    persistSessionById: vi.fn(),
    broadcastToSession: vi.fn(),
    broadcastGlobal: vi.fn(),
    completeDoneBoardRowsForQuest: vi.fn(),
  } as any;
}

let app: Hono;
let launcher: ReturnType<typeof createMockLauncher>;
let bridge: ReturnType<typeof createMockBridge>;

beforeEach(() => {
  vi.resetAllMocks();
  mockExecSync.mockReturnValue("");
  launcher = createMockLauncher();
  bridge = createMockBridge();
  const resolveId = (raw: string) => launcher.resolveSessionId(raw);
  app = new Hono();
  app.route(
    "/api",
    createQuestRoutes({
      launcher,
      wsBridge: bridge,
      resolveId,
      authenticateCompanionCallerOptional: (c: any) => validateCompanionAuth(c, launcher, resolveId),
      execCaptureStdoutAsync: async (command: string) => mockExecSync(command),
    } as any),
  );
});

afterEach(() => vi.restoreAllMocks());

describe("POST /api/quests/:questId/complete", () => {
  function companionAuthHeaders(sessionId: string, token: string): Record<string, string> {
    return {
      "x-companion-session-id": sessionId,
      "x-companion-auth-token": token,
      "Content-Type": "application/json",
    };
  }

  function installV2MemoryFixture(
    options: {
      callerId?: string;
      callerToken?: string;
      callerIsLeader?: boolean;
      callerReviewerOf?: number;
      row?: Record<string, unknown>;
      quest?: Record<string, unknown>;
      workerState?: Record<string, unknown>;
      workerLauncher?: Record<string, unknown>;
      completeQuest?: Record<string, unknown>;
      trackedStatus?: string;
    } = {},
  ) {
    const callerId = options.callerId ?? "worker-1";
    const callerToken = options.callerToken ?? "tok";
    const leaderSession = {
      sessionId: "leader-1",
      state: "running",
      cwd: "/test",
      archived: false,
      isOrchestrator: true,
    };
    const workerSession = {
      sessionId: "worker-1",
      state: "running",
      cwd: "/repo",
      archived: false,
      isWorktree: true,
      repoRoot: "/repo",
      branch: "feature",
      actualBranch: "feature-wt-1",
      ...(options.callerReviewerOf !== undefined ? { reviewerOf: options.callerReviewerOf } : {}),
      ...(options.workerLauncher ?? {}),
    };
    launcher.listSessions.mockReturnValue([leaderSession, workerSession] as any);
    launcher.getSession.mockImplementation((sid: string) => {
      if (sid === "leader-1") return leaderSession as any;
      if (sid === "worker-1") return workerSession as any;
      if (sid === "other-worker")
        return { sessionId: "other-worker", state: "running", cwd: "/repo", archived: false } as any;
      if (sid === "other-leader") {
        return {
          sessionId: "other-leader",
          state: "running",
          cwd: "/test",
          archived: false,
          isOrchestrator: true,
        } as any;
      }
      return undefined;
    });
    launcher.verifySessionAuthToken.mockImplementation(
      (sid: string, token: string) => sid === callerId && token === callerToken,
    );
    if (options.trackedStatus !== undefined) {
      mockExecSync.mockImplementation((cmd?: string) =>
        cmd?.includes("status --porcelain") ? (options.trackedStatus ?? "") : "",
      );
    }
    bridge._sessions = {
      "leader-1": {
        id: "leader-1",
        board: new Map([
          [
            "q-1",
            {
              questId: "q-1",
              worker: "worker-1",
              workerNum: 7,
              status: "MEMORY",
              journey: { phaseIds: ["alignment", "work", "memory"], activePhaseIndex: 2, currentPhaseId: "memory" },
              createdAt: 1,
              updatedAt: 2,
              ...(options.row ?? {}),
            },
          ],
        ]),
        completedBoard: new Map(),
        notifications: [],
        pendingPermissions: new Map(),
        taskHistory: [],
        keywords: [],
        attentionRecords: [],
        messageHistory: [],
        browserSockets: new Set(),
      },
      "worker-1": {
        id: "worker-1",
        worktreeStateFingerprint: "",
        diffStatsDirty: false,
        backendSocket: null,
        codexAdapter: null,
        state: {
          cwd: "/repo",
          git_branch: "feature",
          git_default_branch: "origin/feature",
          diff_base_branch: "origin/feature",
          git_head_sha: "abc1234",
          is_worktree: true,
          git_ahead: 0,
          git_behind: 0,
          total_lines_added: 0,
          total_lines_removed: 0,
          git_status_refresh_error: null,
          diff_stats_skipped_reason: null,
          ...(options.workerState ?? {}),
        },
        notifications: [],
        pendingPermissions: new Map(),
        taskHistory: [],
        keywords: [],
        attentionRecords: [],
        messageHistory: [],
        browserSockets: new Set(),
      },
    };
    const quest = {
      id: "q-1-v3",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "worker-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
      feedback: [
        {
          author: "agent",
          authorSessionId: "worker-1",
          phaseId: "work",
          kind: "phase_summary",
          text: "Accepted Work evidence with enough detail to satisfy the v2 completion guard before Memory closure.",
          ts: 1,
        },
        {
          author: "agent",
          authorSessionId: "worker-1",
          phaseId: "memory",
          kind: "phase_summary",
          text: "Final Memory closure.\n\nmemory update not needed: no durable cross-quest learning.",
          ts: 2,
        },
      ],
      ...(options.quest ?? {}),
    } as QuestmasterTask;
    const row = bridge._sessions["leader-1"].board.get("q-1");
    if (!options.quest?.feedback) {
      const docs = resolveQuestFeedbackDocumentation({
        quest,
        authorSessionId: "worker-1",
        request: {},
        boardRows: [{ leaderSessionId: "leader-1", row }],
        now: 3,
      });
      Object.assign(quest.feedback![1]!, docs.entryPatch);
      quest.journeyRuns = docs.journeyRuns;
    }
    vi.spyOn(questStore, "getQuest").mockResolvedValueOnce(quest);
    vi.spyOn(questStore, "completeQuest").mockResolvedValueOnce({
      ...quest,
      status: "done",
      verificationItems: [],
      verificationInboxUnread: true,
      ...(options.completeQuest ?? {}),
    } as any);
    return { callerId, callerToken, quest, row };
  }

  async function postV2Complete(
    body: Record<string, unknown> = {},
    auth: { callerId: string; callerToken: string } = { callerId: "worker-1", callerToken: "tok" },
  ) {
    return app.request("/api/quests/q-1/complete", {
      method: "POST",
      headers: companionAuthHeaders(auth.callerId, auth.callerToken),
      body: JSON.stringify({
        verificationItems: [],
        debrief: "Completed the accepted work and final Memory closure.",
        debriefTldr: "Accepted work is complete with final Memory closure.",
        ...body,
      }),
    });
  }

  function appendPriorMemoryRun(quest: QuestmasterTask, row: any) {
    const docs = resolveQuestFeedbackDocumentation({
      quest,
      authorSessionId: "worker-1",
      request: {},
      boardRows: [{ leaderSessionId: "leader-1", row: { ...row, createdAt: 0, completedAt: 1 } }],
      now: 50,
    });
    expect(docs.error ?? docs.warning).toBeUndefined();
    quest.journeyRuns = docs.journeyRuns;
    // The old note was edited most recently and is last in the array. Neither
    // timestamps nor array order may override the active board's identity.
    quest.feedback!.push({
      author: "agent",
      authorSessionId: "worker-1",
      text: "memory updated: prior-memory-commit",
      ts: 50,
      ...docs.entryPatch,
    });
  }

  it.each([
    "memory updated: current-memory-commit",
    "memory update deferred: assigned curator",
    "memory update not needed: no new durable learning",
  ])("completes a reopened quest with one current statement: %s", async (statement) => {
    // Reusing the same worker across two retained Journeys caused the original
    // false duplicate rejection. Completion must preserve both histories.
    const auth = installV2MemoryFixture();
    auth.quest.feedback![1]!.text = statement;
    appendPriorMemoryRun(auth.quest, auth.row);
    const before = structuredClone(auth.quest);

    const res = await postV2Complete({}, auth);

    expect(res.status, await res.clone().text()).toBe(200);
    expect(questStore.completeQuest).toHaveBeenCalledOnce();
    expect(auth.quest).toEqual(before);
    expect(questStore.patchQuest).not.toHaveBeenCalled();
  });

  it.each([
    ["historical evidence only", 0, false],
    ["two statements in one current note", 2, false],
    ["statements in two current notes", 2, true],
  ])("rejects reopened completion with %s", async (_label, count, separateNotes) => {
    const auth = installV2MemoryFixture();
    const note = auth.quest.feedback![1]!;
    if (count === 0) note.text = "No final memory statement in this occurrence.";
    else if (separateNotes) auth.quest.feedback!.push({ ...note });
    else note.text += "\nmemory update deferred: duplicate current statement";
    appendPriorMemoryRun(auth.quest, auth.row);

    const res = await postV2Complete({}, auth);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining(`found ${count}`) });
    expect(questStore.completeQuest).not.toHaveBeenCalled();
  });

  it.each([
    ["foreign author", { authorSessionId: "other-worker" }],
    ["human author", { author: "human", addressed: true }],
    ["unscoped legacy note", { journeyRunId: undefined, phaseOccurrenceId: undefined }],
    ["run without occurrence", { phaseOccurrenceId: undefined }],
    ["foreign run with current occurrence", { journeyRunId: "another-run" }],
    ["earlier occurrence in current run", { phaseOccurrenceId: "board-leader-1-1:p1" }],
    ["deleted current note", { deletedAt: 10 }],
    ["non-Memory phase", { phaseId: "work" }],
  ])("does not accept %s as current Memory evidence", async (_label, patch) => {
    // A matching statement alone is insufficient: current scope, live status,
    // phase and assigned-worker authorship must all agree.
    const auth = installV2MemoryFixture();
    Object.assign(auth.quest.feedback![1]!, patch);
    appendPriorMemoryRun(auth.quest, auth.row);

    const res = await postV2Complete({}, auth);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("found 0") });
    expect(questStore.completeQuest).not.toHaveBeenCalled();
  });

  it("uses a retained current occurrence ID without rebuilding it from position", async () => {
    // Persisted occurrence identity can differ from the default generated ID.
    const auth = installV2MemoryFixture();
    auth.quest.journeyRuns![0]!.phaseOccurrences[2]!.occurrenceId = "retained-memory-occurrence";
    auth.quest.feedback![1]!.phaseOccurrenceId = "retained-memory-occurrence";
    appendPriorMemoryRun(auth.quest, auth.row);

    const res = await postV2Complete({}, auth);

    expect(res.status, await res.clone().text()).toBe(200);
  });

  it("rejects inconsistent board phase identity instead of accepting unscoped evidence", async () => {
    const auth = installV2MemoryFixture({
      row: { journey: { phaseIds: ["alignment", "work", "memory"], activePhaseIndex: 1, currentPhaseId: "work" } },
    });

    const res = await postV2Complete({}, auth);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("found 0") });
    expect(questStore.completeQuest).not.toHaveBeenCalled();
  });

  it("uses Work-recorded code commits for active v2 Memory completion without resubmission", async () => {
    const auth = installV2MemoryFixture({
      workerState: { total_lines_added: 12, total_lines_removed: 1 },
      quest: { commitShas: ["abc1234"] },
    });

    const res = await postV2Complete({}, auth);

    expect(res.status, await res.clone().text()).toBe(200);
    expect(bridge.getSessionGitStateDeps).toHaveBeenCalled();
    expect(bridge.refreshWorktreeGitStateForSnapshot).not.toHaveBeenCalled();
    expect(questStore.completeQuest).toHaveBeenCalledWith("q-1", [], {
      commitShas: undefined,
      memoryCommitShas: undefined,
      debrief: "Completed the accepted work and final Memory closure.",
      debriefTldr: "Accepted work is complete with final Memory closure.",
    });
    expect(bridge.completeDoneBoardRowsForQuest).toHaveBeenCalledWith("q-1");
    expect(bridge._sessions["worker-1"].messageHistory).toEqual([
      expect.objectContaining({ type: "quest_lifecycle_event", kind: "submitted", questId: "q-1" }),
    ]);
  });

  it("allows final Memory to repeat code SHAs that Work already recorded", async () => {
    const auth = installV2MemoryFixture({
      workerState: { total_lines_added: 12 },
      quest: { commitShas: ["abc1234"] },
    });

    const res = await postV2Complete({ commitShas: ["ABC1234", "abc1234"] }, auth);

    expect(res.status, await res.clone().text()).toBe(200);
    expect(questStore.completeQuest).toHaveBeenCalledWith(
      "q-1",
      [],
      expect.objectContaining({ commitShas: ["ABC1234", "abc1234"] }),
    );
  });

  it("rejects final Memory attempts to introduce a new code commit SHA", async () => {
    const auth = installV2MemoryFixture({ quest: { commitShas: ["abc1234"] } });

    const res = await postV2Complete({ commitShas: ["deadbeef"] }, auth);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("Work -> Memory") });
    expect(questStore.completeQuest).not.toHaveBeenCalled();
  });

  it("does not let memory-repository SHAs substitute for missing Work code evidence", () => {
    // Memory SHAs are intentionally absent from this validator's contract: only
    // code commits already stored on the quest can cover tracked project changes.
    expect(
      validateV2CompletionGitState(
        {
          cwd: "/repo",
          diff_base_branch: "origin/feature",
          git_ahead: 0,
          git_behind: 0,
          total_lines_added: 12,
          total_lines_removed: 0,
          git_status_refresh_error: null,
          diff_stats_skipped_reason: null,
        },
        undefined,
      ),
    ).toContain("Work -> Memory");
  });

  it("fails closed when the authoritative git refresh path is unavailable", async () => {
    const auth = installV2MemoryFixture({ quest: { commitShas: ["abc1234"] } });
    bridge.getSessionGitStateDeps.mockReturnValueOnce(undefined);

    const res = await postV2Complete({}, auth);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "Cannot refresh worker git state for v2 Memory completion.",
    });
    expect(questStore.completeQuest).not.toHaveBeenCalled();
  });

  it("allows the owning leader to complete v2 Memory on behalf of the assigned worker", async () => {
    const auth = installV2MemoryFixture({ callerId: "leader-1", callerToken: "leader-token" });

    const res = await postV2Complete({ sessionId: "worker-1", memoryCommitShas: ["def5678"] }, auth);

    expect(res.status, await res.clone().text()).toBe(200);
    expect(questStore.completeQuest).toHaveBeenCalledWith("q-1", [], {
      commitShas: undefined,
      memoryCommitShas: ["def5678"],
      sessionId: "worker-1",
      debrief: "Completed the accepted work and final Memory closure.",
      debriefTldr: "Accepted work is complete with final Memory closure.",
    });
  });

  it.each([
    ["wrong worker", { callerId: "other-worker", callerToken: "tok" }, {}, 403],
    ["reviewer caller", { callerId: "worker-1", callerToken: "tok" }, { callerReviewerOf: 7 }, 403],
    ["other leader", { callerId: "other-leader", callerToken: "tok" }, { callerIsLeader: true }, 403],
  ])("rejects v2 Memory completion from %s", async (_label, auth, fixture, status) => {
    installV2MemoryFixture(fixture as any);
    launcher.verifySessionAuthToken.mockImplementation(
      (sid: string, token: string) => sid === auth.callerId && token === auth.callerToken,
    );

    const res = await postV2Complete({}, auth);

    expect(res.status).toBe(status);
    expect(questStore.completeQuest).not.toHaveBeenCalled();
  });

  it.each([
    [
      "wrong phase",
      {
        row: {
          status: "WORKING",
          journey: { phaseIds: ["alignment", "work", "memory"], activePhaseIndex: 1, currentPhaseId: "work" },
        },
      },
      "MEMORY",
    ],
    ["unresolved checkpoint", { row: { waitForInput: ["n-1"] } }, "User Checkpoint"],
    ["missing debrief", {}, "Final debrief", { debrief: "" }],
    ["missing debrief TLDR", {}, "Final debrief TLDR", { debriefTldr: "" }],
    [
      "unaddressed feedback",
      { quest: { feedback: [{ author: "human", text: "Please fix", ts: 1, addressed: false }] } },
      "human feedback",
    ],
    ["missing memory statement", { quest: { feedback: [] } }, "exactly one final memory statement"],
    [
      "duplicate memory statements",
      {
        quest: {
          feedback: [
            {
              author: "agent",
              authorSessionId: "worker-1",
              phaseId: "work",
              kind: "phase_summary",
              text: "Accepted Work evidence with enough detail to satisfy the v2 completion guard before Memory closure.",
              ts: 1,
            },
            {
              author: "agent",
              authorSessionId: "worker-1",
              phaseId: "memory",
              journeyRunId: "board-leader-1-1",
              phaseOccurrenceId: "board-leader-1-1:p3",
              kind: "phase_summary",
              text: "memory updated: abc\nmemory update not needed: duplicate",
              ts: 2,
            },
          ],
        },
      },
      "exactly one final memory statement",
    ],
    ["dirty tracked changes", { trackedStatus: " M web/server/file.ts\n" }, "tracked changes"],
    ["ahead worktree", { workerState: { git_ahead: 1 } }, "ahead"],
    ["uncertain git state", { workerState: { git_status_refresh_error: "status failed" } }, "uncertain"],
    ["missing remote-backed sync counts", { workerState: { is_worktree: false, git_ahead: undefined } }, "sync state"],
    [
      "missing remote-backed comparison target",
      { workerState: { is_worktree: false, git_default_branch: "", diff_base_branch: "" } },
      "comparison target",
    ],
    ["ahead non-worktree remote-backed branch", { workerState: { is_worktree: false, git_ahead: 1 } }, "ahead"],
    ["behind non-worktree remote-backed branch", { workerState: { is_worktree: false, git_behind: 1 } }, "behind"],
    [
      "uncertain non-worktree remote-backed branch",
      { workerState: { is_worktree: false, git_status_refresh_error: "refresh budget" } },
      "uncertain",
    ],
  ])("rejects v2 Memory completion with %s", async (_label, fixture, errorText, body?: Record<string, unknown>) => {
    const auth = installV2MemoryFixture(fixture as any);

    const res = await postV2Complete(body ?? {}, auth);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining(errorText) });
    expect(questStore.completeQuest).not.toHaveBeenCalled();
  });

  it("allows v2 Memory completion when the only human feedback slot was deleted", async () => {
    const auth = installV2MemoryFixture({
      quest: {
        feedback: [
          { author: "human", text: "", ts: 0, deletedAt: 1 },
          {
            author: "agent",
            authorSessionId: "worker-1",
            phaseId: "work",
            kind: "phase_summary",
            text: "Accepted Work evidence with enough detail to satisfy the v2 completion guard before Memory closure.",
            ts: 2,
          },
          {
            author: "agent",
            authorSessionId: "worker-1",
            phaseId: "memory",
            journeyRunId: "board-leader-1-1",
            phaseOccurrenceId: "board-leader-1-1:p3",
            kind: "phase_summary",
            text: "Final Memory closure.\n\nmemory update not needed: no durable cross-quest learning.",
            ts: 3,
          },
        ],
      },
    });

    const res = await postV2Complete({}, auth);

    expect(res.status, await res.clone().text()).toBe(200);
    expect(questStore.completeQuest).toHaveBeenCalled();
  });

  it("preserves zero-tracked-change v2 completion", async () => {
    const zeroAuth = installV2MemoryFixture();
    const zero = await postV2Complete({}, zeroAuth);
    expect(zero.status).toBe(200);
  });

  it("allows clean synced non-worktree remote-backed v2 completion", async () => {
    const auth = installV2MemoryFixture({ workerState: { is_worktree: false, git_ahead: 0, git_behind: 0 } });

    const res = await postV2Complete({}, auth);

    expect(res.status, await res.clone().text()).toBe(200);
  });

  it("rejects dirty tracked git status even when commit metadata is present", async () => {
    const auth = installV2MemoryFixture({ quest: { commitShas: ["abc1234"] } });
    mockExecSync.mockImplementation((cmd?: string) =>
      cmd?.includes("status --porcelain --untracked-files=no") ? " M web/server/file.ts\n" : "",
    );

    const res = await postV2Complete({ commitShas: ["abc1234"] }, auth);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("uncommitted tracked changes") });
    expect(questStore.completeQuest).not.toHaveBeenCalled();
  });

  it("rejects remote-backed worktree completion when the caller self-selects local-clean", async () => {
    const auth = installV2MemoryFixture({
      workerState: { git_ahead: 2 },
      quest: { commitShas: ["abc1234"] },
    });

    const res = await postV2Complete({ commitShas: ["abc1234"], v2CompletionSync: "local-clean" }, auth);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("ahead") });
    expect(questStore.completeQuest).not.toHaveBeenCalled();
  });

  it("rejects remote-backed non-worktree completion when the caller self-selects local-clean", async () => {
    const auth = installV2MemoryFixture({
      workerState: { is_worktree: false, git_ahead: 2, git_behind: 1 },
      quest: { commitShas: ["abc1234"] },
    });

    const res = await postV2Complete({ commitShas: ["abc1234"], v2CompletionSync: "local-clean" }, auth);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("ahead") });
    expect(questStore.completeQuest).not.toHaveBeenCalled();
  });

  it("allows server-proven local-only clean v2 completion with structured accepted state", async () => {
    const auth = installV2MemoryFixture({
      workerLauncher: {
        worktreePortTarget: {
          repoRoot: "/repo",
          branch: "leader-local-wt-1",
          worktreePath: "/worktrees/repo/leader-local-wt-1",
          sourceSessionNum: 7,
        },
      },
      workerState: {
        is_worktree: true,
        git_ahead: 2,
        git_behind: 1,
        git_default_branch: "",
        diff_base_branch: "",
        total_lines_added: 4,
      },
      quest: { commitShas: ["abc1234"] },
    });

    const res = await postV2Complete({ commitShas: ["abc1234"], v2CompletionSync: "local-clean" }, auth);

    expect(res.status, await res.clone().text()).toBe(200);
  });

  it("applies the same v2 Memory guard to transition-done route shapes before mutation", async () => {
    const auth = installV2MemoryFixture({ quest: { feedback: [] } });
    const transitionSpy = vi.spyOn(questStore, "transitionQuest");

    const rejected = await app.request("/api/quests/q-1/transition", {
      method: "POST",
      headers: companionAuthHeaders(auth.callerId, auth.callerToken),
      body: JSON.stringify({
        status: "done",
        debrief: "Completed the accepted work and final Memory closure.",
        debriefTldr: "Accepted work is complete with final Memory closure.",
      }),
    });

    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({
      error: expect.stringContaining("exactly one final memory statement"),
    });
    expect(questStore.completeQuest).not.toHaveBeenCalled();
    expect(transitionSpy).not.toHaveBeenCalled();
  });

  it("allows transition-done after the shared v2 Memory guard passes", async () => {
    const auth = installV2MemoryFixture();
    const transitionSpy = vi.spyOn(questStore, "transitionQuest").mockResolvedValueOnce({
      id: "q-1-v4",
      questId: "q-1",
      title: "Quest",
      status: "done",
      description: "Ready",
      previousOwnerSessionIds: ["worker-1"],
      verificationItems: [],
      verificationInboxUnread: true,
    } as any);

    const res = await app.request("/api/quests/q-1/transition", {
      method: "POST",
      headers: companionAuthHeaders(auth.callerId, auth.callerToken),
      body: JSON.stringify({
        status: "done",
        debrief: "Completed the accepted work and final Memory closure.",
        debriefTldr: "Accepted work is complete with final Memory closure.",
      }),
    });

    expect(res.status, await res.clone().text()).toBe(200);
    expect(transitionSpy).toHaveBeenCalledWith(
      "q-1",
      expect.objectContaining({
        status: "done",
        debrief: "Completed the accepted work and final Memory closure.",
        debriefTldr: "Accepted work is complete with final Memory closure.",
      }),
    );
  });

  it("applies the same v2 Memory guard to deprecated done route shapes", async () => {
    const auth = installV2MemoryFixture({ row: { waitForInput: ["n-1"] } });
    const transitionSpy = vi.spyOn(questStore, "transitionQuest");

    const res = await app.request("/api/quests/q-1/done", {
      method: "POST",
      headers: companionAuthHeaders(auth.callerId, auth.callerToken),
      body: JSON.stringify({
        debrief: "Completed the accepted work and final Memory closure.",
        debriefTldr: "Accepted work is complete with final Memory closure.",
      }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("User Checkpoint") });
    expect(transitionSpy).not.toHaveBeenCalled();
  });

  it("allows deprecated done after the shared v2 Memory guard passes", async () => {
    const auth = installV2MemoryFixture();
    const transitionSpy = vi.spyOn(questStore, "transitionQuest").mockResolvedValueOnce({
      id: "q-1-v4",
      questId: "q-1",
      title: "Quest",
      status: "done",
      description: "Ready",
      previousOwnerSessionIds: ["worker-1"],
      verificationItems: [],
      verificationInboxUnread: true,
    } as any);

    const res = await app.request("/api/quests/q-1/done", {
      method: "POST",
      headers: companionAuthHeaders(auth.callerId, auth.callerToken),
      body: JSON.stringify({
        debrief: "Completed the accepted work and final Memory closure.",
        debriefTldr: "Accepted work is complete with final Memory closure.",
      }),
    });

    expect(res.status, await res.clone().text()).toBe(200);
    expect(transitionSpy).toHaveBeenCalledWith(
      "q-1",
      expect.objectContaining({
        status: "done",
        debrief: "Completed the accepted work and final Memory closure.",
        debriefTldr: "Accepted work is complete with final Memory closure.",
      }),
    );
  });

  it("allows an authenticated leader to complete on behalf of a worker session", async () => {
    vi.spyOn(questStore, "getQuest").mockResolvedValueOnce({
      id: "q-1-v3",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "worker-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);
    vi.spyOn(questStore, "completeQuest").mockResolvedValueOnce({
      id: "q-1-v4",
      questId: "q-1",
      title: "Quest",
      status: "done",
      sessionId: "worker-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
      verificationItems: [{ text: "Verify handoff", checked: false }],
      verificationInboxUnread: true,
    } as any);
    launcher.getSession.mockImplementation((sid: string) => {
      if (sid === "leader-1") {
        return { sessionId: "leader-1", state: "running", cwd: "/test", archived: false, isOrchestrator: true };
      }
      if (sid === "worker-1") {
        return { sessionId: "worker-1", state: "running", cwd: "/test", archived: false };
      }
      return undefined;
    });
    launcher.verifySessionAuthToken.mockImplementation(
      (sid: string, token: string) => sid === "leader-1" && token === "leader-token",
    );

    const res = await app.request("/api/quests/q-1/complete", {
      method: "POST",
      headers: companionAuthHeaders("leader-1", "leader-token"),
      body: JSON.stringify({
        sessionId: "worker-1",
        verificationItems: [{ text: "Verify handoff", checked: false }],
      }),
    });

    expect(res.status, await res.clone().text()).toBe(200);
    expect(questStore.completeQuest).toHaveBeenCalledWith("q-1", [{ text: "Verify handoff", checked: false }], {
      commitShas: undefined,
      sessionId: "worker-1",
    });
    expect(bridge.completeDoneBoardRowsForQuest).toHaveBeenCalledWith("q-1");
  });

  it("resolves numeric completion sessionId before leader authorization and lookup", async () => {
    vi.spyOn(questStore, "getQuest").mockResolvedValueOnce({
      id: "q-1-v3",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "worker-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);
    vi.spyOn(questStore, "completeQuest").mockResolvedValueOnce({
      id: "q-1-v4",
      questId: "q-1",
      title: "Quest",
      status: "done",
      sessionId: "worker-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
      verificationItems: [{ text: "Verify handoff", checked: false }],
      verificationInboxUnread: true,
    } as any);
    launcher.resolveSessionId.mockImplementation((ref: string) => (ref === "42" ? "worker-1" : ref));
    launcher.getSession.mockImplementation((sid: string) => {
      if (sid === "leader-1") {
        return { sessionId: "leader-1", state: "running", cwd: "/test", archived: false, isOrchestrator: true };
      }
      if (sid === "worker-1") {
        return { sessionId: "worker-1", state: "running", cwd: "/test", archived: false };
      }
      return undefined;
    });
    launcher.verifySessionAuthToken.mockImplementation(
      (sid: string, token: string) => sid === "leader-1" && token === "leader-token",
    );

    const res = await app.request("/api/quests/q-1/complete", {
      method: "POST",
      headers: companionAuthHeaders("leader-1", "leader-token"),
      body: JSON.stringify({
        sessionId: "42",
        verificationItems: [{ text: "Verify handoff", checked: false }],
      }),
    });

    expect(res.status, await res.clone().text()).toBe(200);
    expect(questStore.completeQuest).toHaveBeenCalledWith("q-1", [{ text: "Verify handoff", checked: false }], {
      commitShas: undefined,
      sessionId: "worker-1",
    });
  });

  it("rejects non-leader completion for a different authenticated session", async () => {
    // Workers may complete their own quests, but only leaders can submit a
    // different worker's session id in the handoff payload.
    const completeSpy = vi.spyOn(questStore, "completeQuest");
    launcher.getSession.mockImplementation((sid: string) => {
      if (sid === "session-1") {
        return { sessionId: "session-1", state: "running", cwd: "/test", archived: false };
      }
      if (sid === "session-2") {
        return { sessionId: "session-2", state: "running", cwd: "/test", archived: false };
      }
      return undefined;
    });
    launcher.verifySessionAuthToken.mockImplementation(
      (sid: string, token: string) => sid === "session-1" && token === "tok-1",
    );

    const res = await app.request("/api/quests/q-1/complete", {
      method: "POST",
      headers: companionAuthHeaders("session-1", "tok-1"),
      body: JSON.stringify({
        sessionId: "session-2",
        verificationItems: [{ text: "Verify handoff", checked: false }],
      }),
    });

    expect(res.status).toBe(403);
    expect(completeSpy).not.toHaveBeenCalled();
  });

  it("allows an authenticated owner to complete without a body sessionId", async () => {
    // The normal claimed-quest path omits sessionId so the store preserves the
    // current owner instead of treating the authenticated caller as an override.
    vi.spyOn(questStore, "getQuest").mockResolvedValueOnce({
      id: "q-1-v3",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "session-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);
    vi.spyOn(questStore, "completeQuest").mockResolvedValueOnce({
      id: "q-1-v4",
      questId: "q-1",
      title: "Quest",
      status: "done",
      sessionId: "session-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
      verificationItems: [{ text: "Verify handoff", checked: false }],
      verificationInboxUnread: true,
    } as any);
    launcher.getSession.mockImplementation((sid: string) =>
      sid === "session-1" ? { sessionId: "session-1", state: "running", cwd: "/test", archived: false } : undefined,
    );
    launcher.verifySessionAuthToken.mockImplementation(
      (sid: string, token: string) => sid === "session-1" && token === "tok-1",
    );

    const res = await app.request("/api/quests/q-1/complete", {
      method: "POST",
      headers: companionAuthHeaders("session-1", "tok-1"),
      body: JSON.stringify({
        verificationItems: [{ text: "Verify handoff", checked: false }],
      }),
    });

    expect(res.status, await res.clone().text()).toBe(200);
    expect(questStore.completeQuest).toHaveBeenCalledWith("q-1", [{ text: "Verify handoff", checked: false }], {
      commitShas: undefined,
    });
  });

  it("rejects non-owner completion when body sessionId is omitted", async () => {
    vi.spyOn(questStore, "getQuest").mockResolvedValueOnce({
      id: "q-1-v3",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "worker-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);
    const completeSpy = vi.spyOn(questStore, "completeQuest");
    launcher.getSession.mockImplementation((sid: string) =>
      sid === "session-1" ? { sessionId: "session-1", state: "running", cwd: "/test", archived: false } : undefined,
    );
    launcher.verifySessionAuthToken.mockImplementation(
      (sid: string, token: string) => sid === "session-1" && token === "tok-1",
    );

    const res = await app.request("/api/quests/q-1/complete", {
      method: "POST",
      headers: companionAuthHeaders("session-1", "tok-1"),
      body: JSON.stringify({
        verificationItems: [{ text: "Verify handoff", checked: false }],
      }),
    });

    expect(res.status).toBe(403);
    expect(completeSpy).not.toHaveBeenCalled();
  });

  it("does not rewrite ownership when an authenticated leader omits body sessionId", async () => {
    vi.spyOn(questStore, "getQuest").mockResolvedValueOnce({
      id: "q-1-v3",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "worker-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);
    vi.spyOn(questStore, "completeQuest").mockResolvedValueOnce({
      id: "q-1-v4",
      questId: "q-1",
      title: "Quest",
      status: "done",
      sessionId: "worker-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
      verificationItems: [{ text: "Verify handoff", checked: false }],
      verificationInboxUnread: true,
    } as any);
    launcher.getSession.mockImplementation((sid: string) =>
      sid === "leader-1"
        ? { sessionId: "leader-1", state: "running", cwd: "/test", archived: false, isOrchestrator: true }
        : undefined,
    );
    launcher.verifySessionAuthToken.mockImplementation(
      (sid: string, token: string) => sid === "leader-1" && token === "leader-token",
    );

    const res = await app.request("/api/quests/q-1/complete", {
      method: "POST",
      headers: companionAuthHeaders("leader-1", "leader-token"),
      body: JSON.stringify({
        verificationItems: [{ text: "Verify handoff", checked: false }],
      }),
    });

    expect(res.status, await res.clone().text()).toBe(200);
    expect(questStore.completeQuest).toHaveBeenCalledWith("q-1", [{ text: "Verify handoff", checked: false }], {
      commitShas: undefined,
    });
  });
});
