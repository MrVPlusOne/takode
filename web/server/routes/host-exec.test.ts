import { Hono } from "hono";
import { Readable } from "node:stream";
import { HostExecError } from "../remote-host/host-exec.js";
import type { ExecJob } from "../../shared/host-exec.js";
import { createHostExecRoutes } from "./host-exec.js";
import type { RouteContext } from "./context.js";

const job = (overrides: Partial<ExecJob> = {}): ExecJob => ({
  id: "x-1",
  hostId: "host-1",
  host: "condor",
  command: "make",
  cwd: null,
  sessionId: "owner",
  sessionNum: 4,
  questId: "q-9",
  background: false,
  status: "running",
  startedAt: 1,
  endedAt: null,
  exitCode: null,
  signal: null,
  error: null,
  outputBytes: 0,
  ...overrides,
});

/**
 * The HTTP side of `takode exec`: who the caller is decides the record's
 * session and quest, and who may stop or detach a command. The commands
 * themselves are covered by HostExec's tests.
 */
describe("takode exec routes", () => {
  let caller: { id: string; isOrchestrator: boolean };
  let exec: {
    start: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
    detach: ReturnType<typeof vi.fn>;
    readLog: ReturnType<typeof vi.fn>;
  };
  let app: Hono;

  beforeEach(() => {
    caller = { id: "owner", isOrchestrator: false };
    exec = {
      start: vi.fn(async () => job()),
      get: vi.fn(() => job()),
      kill: vi.fn(() => job()),
      detach: vi.fn(async () => job({ background: true })),
      readLog: vi.fn(async () => Readable.from(["line 1\n", "line 2\n"])),
    };
    const ctx = {
      authenticateTakodeCaller: () => ({ callerId: caller.id, caller: { isOrchestrator: caller.isOrchestrator } }),
      launcher: { getSessionNum: () => 4 },
      wsBridge: { getSession: () => ({ state: { claimedQuestId: "q-9" } }) },
      options: { hostExec: exec },
    } as unknown as RouteContext;
    app = new Hono().route("/api", createHostExecRoutes(ctx));
  });

  const post = (path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  // A memory limit reaches HostExec in bytes; anything but a positive whole number is refused.
  it("passes a memory limit on and refuses a malformed one", async () => {
    const res = await post("/takode/exec", { host: "condor", command: "make", memoryLimitBytes: 2 ** 30 });
    expect(res.status).toBe(201);
    expect(exec.start).toHaveBeenCalledWith(expect.objectContaining({ memoryLimitBytes: 2 ** 30 }));
    for (const memoryLimitBytes of [0, -1, 1.5, "1G"]) {
      const bad = await post("/takode/exec", { host: "condor", command: "make", memoryLimitBytes });
      expect(bad.status).toBe(400);
    }
    expect(exec.start).toHaveBeenCalledTimes(1);
  });

  it("starts a command for the calling session with its claimed quest", async () => {
    const res = await post("/takode/exec", { host: "condor", command: "make", cwd: "~/repo", background: true });
    expect(res.status).toBe(201);
    expect(exec.start).toHaveBeenCalledWith({
      sessionId: "owner",
      sessionNum: 4,
      questId: "q-9",
      host: "condor",
      command: "make",
      cwd: "~/repo",
      background: true,
    });
  });

  it("answers a refused start with its status and reason", async () => {
    exec.start.mockRejectedValueOnce(new HostExecError(403, "Running commands on condor is turned off"));
    const res = await post("/takode/exec", { host: "condor", command: "make" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Running commands on condor is turned off" });
    expect((await post("/takode/exec", { command: "make" })).status).toBe(400);
  });

  // Stopping someone else's command is for its session or a leader only.
  it("lets only the owner or a leader stop a command, and only the owner detach it", async () => {
    caller = { id: "other", isOrchestrator: false };
    expect((await post("/takode/exec/jobs/x-1/kill")).status).toBe(403);
    expect((await post("/takode/exec/jobs/x-1/detach")).status).toBe(403);
    expect(exec.kill).not.toHaveBeenCalled();

    caller = { id: "leader", isOrchestrator: true };
    expect((await post("/takode/exec/jobs/x-1/kill")).status).toBe(200);
    expect(exec.kill).toHaveBeenCalledWith("x-1");

    caller = { id: "owner", isOrchestrator: false };
    expect((await post("/takode/exec/jobs/x-1/detach")).status).toBe(200);
    expect(exec.detach).toHaveBeenCalledWith("x-1");

    exec.get.mockReturnValueOnce(null);
    expect((await post("/takode/exec/jobs/x-9/kill")).status).toBe(404);
  });

  // `takode exec logs` streams the whole log as text, or a line or byte range.
  it("streams a command's log, whole or as a range", async () => {
    const res = await app.request("/api/takode/exec/jobs/x-1/log?lines=200-400");
    expect(await res.text()).toBe("line 1\nline 2\n");
    expect(exec.readLog).toHaveBeenCalledWith("x-1", { readerSessionId: "owner", lines: [200, 400] });
    await app.request("/api/takode/exec/jobs/x-1/log?bytes=7");
    expect(exec.readLog).toHaveBeenLastCalledWith("x-1", { readerSessionId: "owner", bytes: [7, 7] });
    expect((await app.request("/api/takode/exec/jobs/x-1/log?lines=9-3")).status).toBe(400);
    expect((await app.request("/api/takode/exec/jobs/x-1/log?bytes=abc")).status).toBe(400);
  });
});
