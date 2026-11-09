import type { BackgroundTaskInfo } from "./bridge/adapter-interface.js";
import type { SdkSessionInfo } from "./session-info.js";
import { StoppedBackgroundTasks } from "./stopped-background-tasks.js";
import { stoppedBackgroundTasksNotice } from "../shared/stopped-background-tasks.js";

/**
 * A Claude process takes its sub-agents and background commands with it when
 * it ends. The session, usually idle and waiting for them, would never hear
 * of it; these tests pin down when it is told, and that it is told once.
 */
describe("StoppedBackgroundTasks", () => {
  let sessions: Map<string, SdkSessionInfo>;
  let delivered: Array<{ sessionId: string; notice: string }>;
  let persisted: number;
  let stopping: boolean;
  let stops: StoppedBackgroundTasks;

  const task = (taskId: string, kind: BackgroundTaskInfo["kind"], extra: Partial<BackgroundTaskInfo> = {}) => ({
    taskId,
    description: `Task ${taskId}`,
    startedAt: 0,
    kind,
    ...extra,
  });

  beforeEach(() => {
    sessions = new Map([["s1", { sessionId: "s1", state: "connected", cwd: "/repo" } as SdkSessionInfo]]);
    delivered = [];
    persisted = 0;
    stopping = false;
    stops = new StoppedBackgroundTasks({
      session: (sessionId) => sessions.get(sessionId),
      persist: () => persisted++,
      deliver: (sessionId, notice) => delivered.push({ sessionId, notice }),
      stopping: () => stopping,
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("keeps the reported tasks with the session and tells it once when its process is gone", () => {
    stops.reported("s1", [task("a1", "agent"), task("b1", "shell")]);
    expect(sessions.get("s1")!.liveBackgroundTasks).toEqual([
      { id: "a1", description: "Task a1", kind: "agent" },
      { id: "b1", description: "Task b1", kind: "shell" },
    ]);
    expect(persisted).toBe(1);

    stops.processEnded("s1");
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.notice).toContain("`a1`: Task a1");
    expect(delivered[0]!.notice).toContain("- Task b1");
    expect(sessions.get("s1")!.liveBackgroundTasks).toBeUndefined();

    // The new process starting afterwards finds nothing left to tell.
    stops.processEnded("s1");
    expect(delivered).toHaveLength(1);
  });

  it("says nothing when the process had no background tasks, or they all finished", () => {
    stops.processEnded("s1");
    stops.reported("s1", [task("a1", "agent")]);
    stops.reported("s1", []);
    stops.processEnded("s1");
    expect(delivered).toEqual([]);
    expect(sessions.get("s1")!.liveBackgroundTasks).toBeUndefined();
  });

  // A stopping server leaves the tasks recorded: its processes may live on
  // under a node, and if they do not, the next server tells the session.
  it("leaves the tasks for the next server while this one stops", () => {
    stops.reported("s1", [task("a1", "agent")]);
    stopping = true;
    stops.processEnded("s1");
    expect(delivered).toEqual([]);
    expect(sessions.get("s1")!.liveBackgroundTasks).toHaveLength(1);
  });

  it("forgets the tasks of an archived session without telling it", () => {
    stops.reported("s1", [task("a1", "agent")]);
    sessions.get("s1")!.archived = true;
    stops.processEnded("s1");
    expect(delivered).toEqual([]);
    expect(sessions.get("s1")!.liveBackgroundTasks).toBeUndefined();
  });

  // A node update stops the host's sessions before the node restarts; the
  // notice relaunches the session, so it waits until the node is back.
  it("holds the notice while the session's host restarts for an update", () => {
    stops.reported("s1", [task("a1", "agent")]);
    stops.hold("s1");
    stops.processEnded("s1");
    expect(delivered).toEqual([]);
    stops.release("s1");
    expect(delivered).toHaveLength(1);
    // Releasing a session whose process did not end tells it nothing.
    stops.hold("s1");
    stops.release("s1");
    expect(delivered).toHaveLength(1);
  });

  // Killing, archiving or replacing a session leaves it stopped; it hears of
  // its stopped tasks when it next starts, not by being started again now.
  it("tells a session stopped on purpose only when it next starts", () => {
    stops.reported("s1", [task("a1", "agent")]);
    stops.stoppingOnPurpose("s1");
    stops.processEnded("s1");
    expect(delivered).toEqual([]);
    stops.processStarted("s1");
    expect(delivered).toHaveLength(1);

    // Its next process is not stopped on purpose any more.
    stops.reported("s1", [task("a2", "agent")]);
    stops.processEnded("s1");
    expect(delivered).toHaveLength(2);
  });

  // A process that ended while no server was attached (say without a node) is
  // found out when the session starts a new one.
  it("tells a session whose new process did not take over the old one", () => {
    stops.reported("s1", [task("a1", "agent")]);
    stops.processStarted("s1");
    expect(delivered).toHaveLength(1);
  });

  // A process taken over after a server restart reports its tasks again
  // without their depth; the nesting seen before is kept.
  it("keeps which sub-agents were nested across a takeover", () => {
    stops.reported("s1", [task("top", "agent"), task("child", "agent", { nested: true })]);
    stops.reported("s1", [task("top", "agent"), task("child", "agent"), task("new", "agent")]);
    expect(sessions.get("s1")!.liveBackgroundTasks!.map((t) => [t.id, t.nested ?? false])).toEqual([
      ["top", false],
      ["child", true],
      ["new", false],
    ]);
  });
});

describe("stoppedBackgroundTasksNotice", () => {
  it("lists top-level sub-agents by ID to resume, and commands to rerun without their IDs", () => {
    const notice = stoppedBackgroundTasksNotice([
      { id: "a783ea05743767263", description: "Formalize C batch c-18", kind: "agent" },
      { id: "a215553da99a4abf4", description: "Check one problem", kind: "agent", nested: true },
      { id: "bx1", description: "Run the Lean checks", kind: "shell" },
    ]);
    expect(notice).toContain("- `a783ea05743767263`: Formalize C batch c-18");
    expect(notice).not.toContain("a215553da99a4abf4");
    expect(notice).toContain("- Run the Lean checks");
    expect(notice).not.toContain("bx1");
  });

  it("leaves out the sub-agent section when only commands stopped", () => {
    const notice = stoppedBackgroundTasksNotice([{ id: "bx1", description: "Build", kind: "shell" }]);
    expect(notice.split("\n").filter((line) => line.startsWith("- "))).toEqual(["- Build"]);
  });
});
