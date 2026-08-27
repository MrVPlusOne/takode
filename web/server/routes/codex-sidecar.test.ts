import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexSidecarRegistry } from "../codex-sidecar-auth.js";
import { TodoStore } from "../todo-store.js";
import type { RouteContext } from "./context.js";
import { createCodexSidecarRoutes, type CodexSidecarRouteDependencies } from "./codex-sidecar.js";

const CAPABILITY = "test-sidecar-capability";
let root: string;
let todoStore: TodoStore;
let app: Hono;
let registry: CodexSidecarRegistry;
let optionalCaller: any = null;
let boardRow: unknown = null;
const broadcastGlobal = vi.fn();
const memoryRecall = vi.fn();
const memoryRead = vi.fn();
const getLeaseStatus = vi.fn();
const questCommandRunner = vi.fn();

beforeEach(async () => {
  // Every durable store used by these tests lives under a disposable temp root.
  root = mkdtempSync(join(tmpdir(), "takode-codex-sidecar-route-"));
  todoStore = new TodoStore(join(root, "todos.json"));
  registry = new CodexSidecarRegistry({ port: 4567, serverId: "server-test", capability: CAPABILITY });
  await registry.initialize();
  optionalCaller = null;
  boardRow = null;
  broadcastGlobal.mockReset();
  memoryRecall.mockReset().mockResolvedValue({ repo: { root }, matches: [], issues: [] });
  memoryRead.mockReset().mockResolvedValue({ repo: { root }, file: { path: "knowledge/example.md", content: "body" } });
  getLeaseStatus
    .mockReset()
    .mockResolvedValue({ resourceKey: "dev-server:test", lease: null, waiters: [], available: true });
  questCommandRunner.mockReset().mockResolvedValue({ exitCode: 0, stdout: "ok\n", stderr: "" });

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
      memoryService: { recall: memoryRecall, readRecord: memoryRead },
      questCommandRunner,
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
    expect((await request("/integrations/codex/todos", { clientIp: "192.0.2.1" })).status).toBe(403);
    expect(
      (
        await request("/integrations/codex/todos", {
          clientIp: "127.0.0.1",
          capability: "wrong",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/integrations/codex/todos", {
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

  it("runs the canonical Quest argv and returns the CLI result without reshaping it", async () => {
    // CLI stdout and stderr are an interface: the sidecar must pass them
    // through byte-for-byte as strings instead of projecting a second schema.
    questCommandRunner.mockResolvedValueOnce({ exitCode: 0, stdout: "q-7  Ready\n", stderr: "warning\n" });
    const response = await codexQuestCommand(["show", "q-7", "--sections", "description"], "input\n");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ exitCode: 0, stdout: "q-7  Ready\n", stderr: "warning\n" });
    expect(questCommandRunner).toHaveBeenCalledWith({
      args: ["show", "q-7", "--sections", "description"],
      stdin: "input\n",
      actor: {
        kind: "codex_session",
        sessionId: "thr-123",
        turnId: "turn-1",
        toolUseId: "tool-1",
        cwd: "/repo",
      },
    });
    expect(broadcastGlobal).not.toHaveBeenCalled();
  });

  it("broadcasts exactly once only after a successful Quest mutation", async () => {
    // A nonzero CLI exit is a command result, not an HTTP transport failure,
    // and must not tell browsers that durable Quest data changed.
    const succeeded = await codexQuestCommand(["create", "New quest"]);
    expect(succeeded.status).toBe(200);
    expect(broadcastGlobal).toHaveBeenCalledTimes(1);
    expect(broadcastGlobal).toHaveBeenCalledWith({ type: "quest_list_updated" });

    broadcastGlobal.mockClear();
    questCommandRunner.mockResolvedValueOnce({ exitCode: 2, stdout: "", stderr: "invalid flags\n" });
    const failed = await codexQuestCommand(["edit", "q-7", "--unknown"]);
    expect(failed.status).toBe(200);
    expect(await failed.json()).toEqual({ exitCode: 2, stdout: "", stderr: "invalid flags\n" });
    expect(broadcastGlobal).not.toHaveBeenCalled();

    questCommandRunner.mockClear();
    const unknown = await codexQuestCommand(["future-command"]);
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "Unknown or unsupported Quest command" });
    expect(questCommandRunner).not.toHaveBeenCalled();
    expect(broadcastGlobal).not.toHaveBeenCalled();
  });

  it("keeps Takode-managed actors on the existing Quest workflow", async () => {
    // Takode-managed sessions already have authenticated routes with naming,
    // Journey, and ownership side effects that this direct Codex bridge omits.
    optionalCaller = { callerId: "takode-worker", caller: { sessionId: "takode-worker" } };
    const response = await request("/integrations/codex/quest-command", {
      method: "POST",
      body: { args: ["list"] },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Takode-managed sessions must use the existing Quest workflow" });
    expect(questCommandRunner).not.toHaveBeenCalled();
  });

  it("rejects invalid command transport before launching the Quest CLI", async () => {
    // The bounded argv/stdin transport prevents accidental unbounded process
    // input while leaving ordinary CLI failures to the CLI's native output.
    const invalidArgs = await codexRequest("/integrations/codex/quest-command", {
      method: "POST",
      body: { args: "show q-7" },
    });
    const invalidStdin = await codexRequest("/integrations/codex/quest-command", {
      method: "POST",
      body: { args: ["show", "q-7"], stdin: 7 },
    });

    expect(invalidArgs.status).toBe(400);
    expect(await invalidArgs.json()).toEqual({ error: "args must be an array of strings" });
    expect(invalidStdin.status).toBe(400);
    expect(await invalidStdin.json()).toEqual({ error: "stdin must be a string" });
    expect(questCommandRunner).not.toHaveBeenCalled();
  });

  it("blocks boarded mutations and reassign while preserving flat feedback", async () => {
    // A normal Codex task may document a boarded quest, but it cannot bypass
    // the Takode leader's ownership or phase-routing workflow.
    boardRow = { questId: "q-7", status: "WORKING", createdAt: 1, updatedAt: 1 };

    const edit = await codexQuestCommand(["edit", "q-7", "--title", "Bypass"]);
    const scopedFeedback = await codexQuestCommand([
      "feedback",
      "add",
      "q-7",
      "--text",
      "Scoped bypass",
      "--phase",
      "work",
    ]);
    const reassign = await codexQuestCommand(["reassign", "q-7", "--session", "worker-2", "--reason", "Move"]);

    expect(edit.status).toBe(409);
    expect(scopedFeedback.status).toBe(409);
    expect(reassign.status).toBe(403);
    expect(questCommandRunner).not.toHaveBeenCalled();

    const flatFeedback = await codexQuestCommand(
      ["feedback", "add", "q-7", "--text-file", "-", "--no-phase"],
      "Flat documentation\n",
    );
    expect(flatFeedback.status).toBe(200);
    expect(questCommandRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["feedback", "add", "q-7", "--text-file", "-", "--no-phase"],
        stdin: "Flat documentation\n",
      }),
    );
    expect(broadcastGlobal).toHaveBeenCalledTimes(1);
  });

  it("does not expose the obsolete per-command Quest API", async () => {
    // Codex Quest access has one contract now: callers must use the canonical
    // CLI argv endpoint rather than independent projection and mutation routes.
    const search = await request("/integrations/codex/quests/search");
    const detail = await request("/integrations/codex/quests/q-7");
    const create = await request("/integrations/codex/quests", {
      method: "POST",
      body: { title: "Obsolete route" },
    });

    expect([search.status, detail.status, create.status]).toEqual([404, 404, 404]);
    expect(questCommandRunner).not.toHaveBeenCalled();
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

async function codexQuestCommand(args: string[], stdin?: string): Promise<Response> {
  return codexRequest("/integrations/codex/quest-command", {
    method: "POST",
    body: { args, ...(stdin !== undefined ? { stdin } : {}) },
  });
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
