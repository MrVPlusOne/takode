import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardRow } from "../session-types.js";
import type { CompletePublishedDeliveryTarget } from "../../shared/quest-delivery.js";

const home = vi.hoisted(() => ({ path: "" }));
vi.mock("node:os", async (original) => ({ ...(await original<typeof import("node:os")>()), homedir: () => home.path }));
let root: string;
let inherited: string;
let source: string;
let target: CompletePublishedDeliveryTarget;
let store: typeof import("../quest-store.js");
let app: Hono;
let row: BoardRow;
let caller: string;
let workerTarget: {
  isWorktree: boolean;
  cwd: string;
  actualBranch: string;
  worktreePortTarget?: { repoRoot: string; branch: string; worktreePath?: string };
};
let questId: string;
let broadcast: ReturnType<typeof vi.fn>;
let createApp: () => Promise<void>;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function initRepo(path: string) {
  mkdirSync(path);
  git(path, "init", "-b", "integration");
  git(path, "config", "user.email", "fixture@example.test");
  git(path, "config", "user.name", "Fixture");
  commit(path, "base");
}
function commit(path: string, name: string): string {
  writeFileSync(join(path, `${name}.txt`), `${name}\n`);
  git(path, "add", ".");
  git(path, "commit", "-m", name);
  return git(path, "rev-parse", "HEAD");
}
async function post(action: string, body: object) {
  return app.request(`/takode/board/${action}`, { method: "POST", body: JSON.stringify({ questId, ...body }) });
}
async function approve(spec = target): Promise<string> {
  caller = "leader";
  const response = await post("approve-delivery-target", { target: spec });
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  caller = "worker";
  return body.approvalId;
}
function evidence(id?: string) {
  return {
    commitShas: [...target.commitShas],
    workFeedbackIndex: 0,
    ...(id ? { deliveryTargetId: id } : {}),
  };
}

beforeEach(async () => {
  // Both mutable Questmaster stores and every Git operation live inside this disposable root.
  root = realpathSync(mkdtempSync(join(tmpdir(), "independent-delivery-test-")));
  home.path = root;
  inherited = join(root, "inherited");
  source = join(root, "published-source");
  initRepo(inherited);
  initRepo(source);
  const remote = join(root, "published.git");
  git(root, "init", "--bare", remote);
  git(source, "remote", "add", "origin", remote);
  target = { checkoutPath: source, remote: "origin", repositoryUrl: remote, refs: [], commitShas: [] };
  for (const name of ["runtime", "eval", "training"]) {
    const sha = commit(source, name);
    const ref = `refs/heads/user/${name}`;
    target.refs.push({ ref, sha });
    target.commitShas.push(sha);
  }
  git(source, "push", "--atomic", "origin", ...target.refs.map(({ ref, sha }) => `${sha}:${ref}`));
  // Deliberately keep the checkout on integration, not on any published branch.
  vi.resetModules();
  store = await import("../quest-store.js");
  const quest = await store.createQuest({
    title: "Independent publication",
    status: "refined",
    description: "Approved delivery",
  });
  questId = quest.questId;
  await store.claimQuest(questId, "worker");
  await store.appendQuestFeedback(questId, {
    author: "agent",
    authorSessionId: "worker",
    phaseId: "work",
    kind: "phase_summary",
    ts: 100,
    journeyRunId: "board-leader-100",
    phaseOccurrenceId: "board-leader-100:p2",
    text: "Implementation and all isolated checks are complete. The approved independent publication is verified; this note owns current Work evidence.",
  });
  row = {
    questId,
    worker: "worker",
    status: "WORKING",
    createdAt: 100,
    updatedAt: 100,
    journey: { phaseIds: ["alignment", "work", "memory"], activePhaseIndex: 1, currentPhaseId: "work" },
  };
  caller = "worker";
  workerTarget = {
    isWorktree: true,
    cwd: inherited,
    actualBranch: "worker",
    worktreePortTarget: { repoRoot: inherited, branch: "integration" },
  };
  broadcast = vi.fn();
  createApp = async () => {
    const { registerTakodeBoardRoutes } = await import("./takode-board.js");
    const { registerQuestDeliveryRoutes } = await import("./quest-deliveries.js");
    const session = {
      id: "leader",
      state: {},
      board: new Map([[questId, row]]),
      completedBoard: new Map(),
      notifications: [],
      boardDispatchStates: new Map(),
      boardStallStates: new Map(),
      attentionRecords: [],
    };
    app = new Hono();
    registerTakodeBoardRoutes(app, {
      launcher: {} as never,
      wsBridge: {
        getSession: (id: string) => (id === "leader" ? session : null),
        findAssignedBoardRowsForWorker: (worker: string) =>
          worker === row.worker ? [{ leaderSessionId: "leader", row }] : [],
        broadcastGlobal: broadcast,
      } as never,
      authenticateTakodeCaller: (() => ({
        callerId: caller,
        caller: {
          sessionId: caller,
          isOrchestrator: caller !== "worker" && caller !== "stranger",
          ...workerTarget,
        },
      })) as never,
      resolveId: (id: string) => id,
      boardWatchdogDeps: {
        getSession: () => session,
        getLauncherSessionInfo: () => undefined,
        listSessions: () => [],
        resolveSessionId: () => undefined,
        timerCount: () => 0,
        backendConnected: () => true,
        getBoard: () => [...session.board.values()],
        emitTakodeEvent: () => {},
        markNotificationDone: () => true,
        isSessionIdle: () => true,
      } as never,
      workBoardStateDeps: {
        getBoardDispatchableSignature: () => null,
        markNotificationDone: () => true,
        broadcastBoard: () => {
          row = session.board.get(questId)!;
        },
        broadcastAttentionRecords: () => {},
        persistSession: () => {},
        notifyReview: () => {},
      } as never,
      buildBoardRowSessionStatuses: async () => ({}),
      resolveSessionDeps: () => [],
    });
    registerQuestDeliveryRoutes(app);
  };
  await createApp();
}, 30_000);
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("independent published delivery through real guarded routes", () => {
  it("runs the normal CLI approval, recording and Memory commands against isolated real handlers", async () => {
    // Real CLI subprocesses talk only to this ephemeral loopback server and disposable Questmaster/Git stores.
    target.refs = [target.refs.at(-1)!];
    const targetPath = join(root, "complete-target.json");
    writeFileSync(targetPath, JSON.stringify(target));
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      if (request.url === "/api/takode/me") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ isOrchestrator: caller === "leader" }));
        return;
      }
      const result = await app.request(request.url!.replace(/^\/api/, ""), {
        method: request.method,
        ...(body ? { body } : {}),
      });
      response.writeHead(result.status, { "content-type": "application/json" });
      response.end(await result.text());
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const script = fileURLToPath(new URL("../../bin/takode.ts", import.meta.url));
    const run = async (args: string[]) => {
      const child = spawn(process.execPath, [script, "board", ...args, "--json", "--port", String(port)], {
        cwd: root,
        env: { ...process.env, COMPANION_SESSION_ID: caller, COMPANION_AUTH_TOKEN: "fixture-token" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const [code] = await once(child, "close");
      expect(code, stderr || stdout).toBe(0);
      return JSON.parse(stdout);
    };
    try {
      caller = "leader";
      const approval = await run(["approve-delivery-target", questId, "--target-file", targetPath]);
      expect(approval).toMatchObject({ refCount: 1, commitCount: 3 });
      caller = "worker";
      const args = [
        questId,
        "--work-note",
        "0",
        "--commits",
        target.commitShas.join(","),
        "--delivery-target",
        approval.approvalId,
      ];
      const recording = await run(["record-work-delivery", ...args]);
      expect(recording.commitShas).toEqual(target.commitShas);
      await run(["work-to-memory", ...args]);
      expect(row.status).toBe("MEMORY");
      expect((await store.getQuest(questId))?.commitShas).toEqual(target.commitShas);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("preserves historical head-only approval and delivery data while requiring a fresh complete-set approval", async () => {
    // Seed an authentic old-shaped record in the disposable store; never backfill or rewrite it during lookup.
    const { commitShas: _commits, ...legacyTarget } = target;
    legacyTarget.refs = [legacyTarget.refs.at(-1)!];
    const { deliveryTargetApprovalId } = await import("../published-delivery-target.js");
    const { readCommitSummary } = await import("../git-commit-reader.js");
    const scope = {
      leaderSessionId: "leader",
      workerSessionId: "worker",
      phaseOccurrenceId: "board-leader-100:p2",
      target: legacyTarget,
    };
    const id = deliveryTargetApprovalId(questId, scope);
    const approval = { ...scope, id, approvedAt: 100 };
    await store.appendQuestDeliveryTargetApproval(questId, approval);
    const head = legacyTarget.refs[0]!.sha;
    const delivery = {
      id: "d".repeat(32),
      recordedAt: 100,
      actorSessionId: "worker",
      phaseOccurrenceId: scope.phaseOccurrenceId,
      target: {
        repoRoot: source,
        checkoutPath: source,
        branch: "user/training",
        mode: "published" as const,
        publication: { ...legacyTarget, approvalId: id },
      },
      targetHeadSha: head,
      commits: [await readCommitSummary(source, head)],
    };
    await store.appendQuestCodeCommitEvidenceForOwner(
      questId,
      { kind: "takode", sessionId: "worker" },
      [head],
      delivery,
    );
    const before = JSON.stringify(await store.getQuest(questId));
    const compact = await (await app.request(`/takode/board/delivery-targets/${questId}`)).json();
    expect(compact.approvals[0]).toMatchObject({ id, refCount: 1, commitCount: null });
    const details = await (await app.request(`/takode/board/delivery-targets/${questId}/${id}`)).json();
    expect(details.approval).toEqual(approval);
    expect((await (await app.request(`/quests/${questId}/deliveries/${delivery.id}`)).json()).commits).toHaveLength(1);
    const rejected = await post("record-work-delivery", { ...evidence(id), commitShas: [head] });
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toContain("fresh complete-set approval");
    expect(JSON.stringify(await store.getQuest(questId))).toBe(before);
  });

  it("records all three final commits behind one published head and rejects a head-only handoff", async () => {
    // Reproduce the omitted implementation: one ref is a publication receipt, not a one-commit Work set.
    const relevant = [...target.commitShas];
    target.refs = [target.refs.at(-1)!];
    const base = git(source, "rev-parse", `${relevant[0]}^`);
    const id = await approve();
    const listing = await (await app.request(`/takode/board/delivery-targets/${questId}`)).json();
    expect(listing.approvals[0]).toMatchObject({ refCount: 1, commitCount: 3 });
    const incomplete = await post("work-to-memory", { ...evidence(id), commitShas: [relevant[2]] });
    expect(incomplete.status).toBe(409);
    expect((await incomplete.json()).error).toContain("complete approved commitShas");
    expect((await store.getQuest(questId))?.codeDeliveries).toBeUndefined();
    const recorded = await (await post("record-work-delivery", evidence(id))).json();
    expect(recorded.delivery.commits.map((item: { sha: string }) => item.sha)).toEqual(relevant);
    expect(recorded.delivery.commits.map((item: { sha: string }) => item.sha)).not.toContain(base);
    expect((await post("work-to-memory", evidence(id))).status).toBe(200);
    const saved = (await store.getQuest(questId))!;
    expect(saved.commitShas).toEqual(relevant);
    expect(saved.codeDeliveries).toHaveLength(1);
    const delivery = saved.codeDeliveries![0]!;
    expect(delivery.targetHeadSha).toBe(relevant[2]);
    expect(delivery.target.publication).toMatchObject({ refs: target.refs, commitShas: relevant });
    for (const sha of relevant) {
      const view = await (await app.request(`/quests/${questId}/deliveries/${delivery.id}/commits/${sha}`)).json();
      expect(view).toMatchObject({ sha, available: true });
      expect(view.diff).toContain("diff --git");
    }
  });

  it("diagnoses the inherited target, records all published branches and enters Memory after a restart", async () => {
    const inheritedHead = git(inherited, "rev-parse", "HEAD");
    const missing = await post("work-to-memory", evidence());
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({ error: expect.stringContaining("approve-delivery-target") });
    const id = await approve();
    const approvals = await (await app.request(`/takode/board/delivery-targets/${questId}`)).json();
    expect(approvals.approvals[0]).toMatchObject({ id, refCount: 3 });
    expect(JSON.stringify(approvals)).not.toContain(source);
    const detail = await (await app.request(`/takode/board/delivery-targets/${questId}/${id}`)).json();
    expect(detail.approval.target).toEqual(target);
    expect((await store.getQuest(questId))?.commitShas).toBeUndefined();
    const recorded = await post("record-work-delivery", evidence(id));
    const result = await recorded.json();
    expect(recorded.status, JSON.stringify(result)).toBe(200);
    expect(row.status).toBe("WORKING");
    const href = `/quests/${questId}/deliveries/${result.delivery.id}/commits/${target.refs[0]!.sha}`;
    const before = await (await app.request(href)).json();
    expect(before.diff).toContain("runtime");
    // Reload real persisted storage and recreate route closures; no in-memory approval cache can authorize this.
    vi.resetModules();
    store = await import("../quest-store.js");
    await createApp();
    expect((await post("work-to-memory", { noCode: true, workFeedbackIndex: 0 })).status).toBe(409);
    const completed = await post("work-to-memory", evidence(id));
    expect(completed.status, JSON.stringify(await completed.json())).toBe(200);
    expect(row.status).toBe("MEMORY");
    const persisted = (await store.getQuest(questId))!;
    expect(persisted.commitShas).toEqual(target.refs.map((entry) => entry.sha));
    expect(persisted.codeDeliveries).toHaveLength(1);
    expect(persisted.codeDeliveries![0]!.target.publication).toMatchObject({ ...target, approvalId: id });
    expect(await (await app.request(href)).json()).toEqual(before);
    expect(git(inherited, "rev-parse", "HEAD")).toBe(inheritedHead);
    expect(git(source, "branch", "--show-current")).toBe("integration");
    expect(JSON.stringify(broadcast.mock.calls)).not.toContain("repositoryUrl");
    await store.completeQuest(questId, []);
    expect((await store.getQuest(questId))?.deliveryTargetApprovals?.[0]?.id).toBe(id);
  });

  it("keeps earlier delivery links fixed when a second approved target batch is added", async () => {
    const id = await approve();
    const first = await (await post("record-work-delivery", evidence(id))).json();
    const href = `/quests/${questId}/deliveries/${first.delivery.id}`;
    const before = await (await app.request(href)).json();
    const oldShas = target.refs.map((item) => item.sha);
    const sha = commit(source, "followup");
    const ref = "refs/heads/user/followup";
    git(source, "push", "origin", `${sha}:${ref}`);
    target = { ...target, refs: [{ ref, sha }], commitShas: [...oldShas, sha] };
    const second = await approve();
    expect(second).not.toBe(id);
    expect((await post("record-work-delivery", evidence(second))).status).toBe(200);
    // The approved complete current Work set may include an earlier recorded prefix; only the new suffix is new.
    expect((await store.getQuest(questId))?.codeDeliveries?.at(-1)?.commits.map((item) => item.sha)).toEqual([sha]);
    expect(
      (await post("work-to-memory", { commitShas: oldShas, workFeedbackIndex: 0, deliveryTargetId: id })).status,
    ).toBe(409);
    expect((await post("work-to-memory", evidence(second))).status).toBe(200);
    expect((await store.getQuest(questId))?.commitShas).toEqual([...oldShas, sha]);
    expect(await (await app.request(href)).json()).toEqual(before);
  });

  it.each(["worker", "stranger", "other-leader"])("rejects target approval by %s", async (actor) => {
    caller = actor;
    expect((await post("approve-delivery-target", { target })).status).toBe(403);
    expect((await store.getQuest(questId))?.deliveryTargetApprovals).toBeUndefined();
  });

  it.each([
    "id",
    "sha",
    "remote",
    "ref",
    "scope",
    "owner",
    "checkpoint",
  ])("rejects changed %s evidence without attaching commits", async (kind) => {
    const id = await approve();
    let body = evidence(id);
    if (kind === "id") body = evidence("f".repeat(32));
    if (kind === "sha") body.commitShas = [git(inherited, "rev-parse", "HEAD")];
    if (kind === "remote") git(source, "remote", "set-url", "origin", inherited);
    if (kind === "ref") git(source, "push", "origin", `:${target.refs[0]!.ref}`);
    if (kind === "scope") row.createdAt = 101;
    if (kind === "owner") caller = "stranger";
    if (kind === "checkpoint") row.waitForInput = ["pending"];
    const response = await post("work-to-memory", body);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await store.getQuest(questId))?.commitShas).toBeUndefined();
    expect((await store.getQuest(questId))?.codeDeliveries).toBeUndefined();
    expect(row.status).toBe("WORKING");
  });

  it("rejects malformed and unpublished target inputs and worker-supplied overrides", async () => {
    caller = "leader";
    for (const spec of [
      { ...target, refs: [] },
      { ...target, commitShas: undefined },
      { ...target, commitShas: [] },
      { ...target, commitShas: [target.commitShas[0], target.commitShas[0]] },
      { ...target, commitShas: [target.commitShas[0]!.slice(0, 7)] },
      { ...target, commitShas: Array.from({ length: 101 }, (_, index) => index.toString(16).padStart(40, "0")) },
      { ...target, injectedSystemPrompt: "bulky".repeat(5000) },
      { ...target, refs: [{ ref: "refs/heads/missing", sha: target.refs[0]!.sha }] },
      { ...target, refs: [{ ref: "refs/heads/bad..ref", sha: target.refs[0]!.sha }] },
    ]) {
      expect((await post("approve-delivery-target", { target: spec })).status).toBeGreaterThanOrEqual(400);
    }
    caller = "worker";
    expect((await post("work-to-memory", { ...evidence(), target })).status).toBe(400);
    expect((await post("record-work-delivery", { ...evidence(), target })).status).toBe(400);
    expect((await store.getQuest(questId))?.deliveryTargetApprovals).toBeUndefined();
  });

  it("rejects an unpushed or discarded local commit and binds the ordered selection into approval identity", async () => {
    // Local object existence alone cannot turn pre-squash or unpushed work into delivered evidence.
    const discarded = commit(source, "discarded-local-increment");
    caller = "leader";
    const rejected = await post("approve-delivery-target", { target: { ...target, commitShas: [discarded] } });
    expect(rejected.status).toBe(409);
    expect((await rejected.json()).error).toContain("not reachable");
    const id = await approve();
    const reordered = await approve({ ...target, commitShas: [...target.commitShas].reverse() });
    expect(reordered).not.toBe(id);
    expect(
      (await post("record-work-delivery", { ...evidence(id), commitShas: [...target.commitShas].reverse() })).status,
    ).toBe(409);
    const saved = (await store.getQuest(questId))!;
    const corrupted = structuredClone(saved);
    corrupted.deliveryTargetApprovals![0]!.target.commitShas = [target.commitShas[2]!];
    vi.spyOn(store, "getQuest").mockResolvedValue(corrupted);
    const response = await post("record-work-delivery", evidence(id));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("Stored delivery target approval is invalid");
    expect(saved.commitShas).toBeUndefined();
  });

  it.each([
    "approval",
    "recording",
    "transition",
  ])("rejects a reassignment during %s verification before recording", async (stage) => {
    // Remote Git reads yield to board changes; bind the race to that exact asynchronous boundary.
    const id = stage === "approval" ? undefined : await approve();
    caller = stage === "approval" ? "leader" : "worker";
    const reader = await import("../git-commit-reader.js");
    const read = reader.readGit;
    vi.spyOn(reader, "readGit").mockImplementation(async (cwd, args) => {
      const result = await read(cwd, args);
      if (args.includes("ls-remote")) row.worker = "replacement-worker";
      return result;
    });
    const response =
      stage === "approval"
        ? await post("approve-delivery-target", { target })
        : await post(stage === "recording" ? "record-work-delivery" : "work-to-memory", evidence(id));
    expect(response.status).toBeGreaterThanOrEqual(400);
    const persisted = (await store.getQuest(questId))!;
    expect(persisted.codeDeliveries).toBeUndefined();
    expect(persisted.commitShas).toBeUndefined();
    if (stage === "approval") expect(persisted.deliveryTargetApprovals).toBeUndefined();
  });

  it("distinguishes unavailable remote verification and rejects corrupted restored approval", async () => {
    const id = await approve();
    const reader = await import("../git-commit-reader.js");
    const read = reader.readGit;
    const remote = vi.spyOn(reader, "readGit").mockImplementation(async (cwd, args) => {
      if (args.includes("ls-remote")) throw new Error("Remote unavailable");
      return read(cwd, args);
    });
    const unavailable = await post("work-to-memory", evidence(id));
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).error).toContain("without repeating publication");
    remote.mockRestore();
    const persisted = (await store.getQuest(questId))!;
    const corrupted = structuredClone(persisted);
    corrupted.deliveryTargetApprovals![0]!.target.refs[0]!.sha = "a".repeat(40);
    vi.spyOn(store, "getQuest").mockResolvedValue(corrupted);
    expect((await post("work-to-memory", evidence(id))).status).toBe(409);
    expect(persisted.commitShas).toBeUndefined();
  });

  it("rechecks published heads after collecting summaries before any evidence write", async () => {
    // A ref can move after the first remote read; a matching initial snapshot is insufficient.
    const id = await approve();
    const reader = await import("../git-commit-reader.js");
    const read = reader.readCommitSummary;
    vi.spyOn(reader, "readCommitSummary").mockImplementation(async (cwd, sha) => {
      const result = await read(cwd, sha);
      git(target.repositoryUrl, "update-ref", "-d", target.refs[0]!.ref);
      return result;
    });
    const response = await post("work-to-memory", evidence(id));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("Published target mismatch");
    expect((await store.getQuest(questId))?.commitShas).toBeUndefined();
  });

  it.each([
    "remote-backed",
    "worktree",
    "direct",
  ])("keeps the inherited %s selected-target flow working", async (mode) => {
    // A normal inherited target still verifies its stable local branch and never requires independent-target approval.
    if (mode === "worktree") {
      const checkoutPath = join(root, "leader-target");
      git(inherited, "worktree", "add", "-b", "leader-target", checkoutPath);
      workerTarget.worktreePortTarget = { repoRoot: inherited, branch: "leader-target", worktreePath: checkoutPath };
    } else if (mode === "direct") {
      workerTarget = { isWorktree: false, cwd: inherited, actualBranch: "integration" };
    }
    const sha = git(inherited, "rev-parse", "HEAD");
    const response = await post("work-to-memory", { commitShas: [sha], workFeedbackIndex: 0 });
    expect(response.status, JSON.stringify(await response.json())).toBe(200);
    expect((await store.getQuest(questId))?.codeDeliveries?.[0]?.target.mode).toBe(mode);
    // The same real target resolver still enforces each original operational checkout mode.
  });
});
