import type { BackgroundTaskInfo } from "./bridge/adapter-interface.js";
import { type LiveBackgroundTask, stoppedBackgroundTasksNotice } from "../shared/stopped-background-tasks.js";
import type { SdkSessionInfo } from "./session-info.js";
import { sessionTag } from "./session-tag.js";

export type { LiveBackgroundTask };

export interface StoppedBackgroundTasksDeps {
  session: (sessionId: string) => SdkSessionInfo | undefined;
  /** Save the sessions' launcher records, where the running tasks are kept. */
  persist: () => void;
  /** Send the session the notice; delivering it starts the session again. */
  deliver: (sessionId: string, notice: string) => void;
  /** The server is stopping; the next one tells the sessions instead. */
  stopping: () => boolean;
}

/**
 * Tells a Claude session which of its background tasks stopped with its
 * process, so it can resume them. A Claude process takes its sub-agents and
 * background commands with it when it ends, whatever ends it: a node update
 * after Restart Server, Takode stopping it at an idle moment (for new
 * instructions, or the machine's keep-alive limit), the memory guard, a crash.
 * Sub-agents keep their transcripts and resume with `SendMessage` to their
 * id; their parent is usually idle, waiting for them, and nothing else would
 * wake it once they are gone, so the notice starts the session again.
 *
 * Only a stop someone asked for (killing, archiving or replacing the session)
 * leaves it stopped: it is told when it next starts. The tasks a process
 * reports are kept with the session, so a restarted server still knows them:
 * the process may end while no server is attached, as when a node is updated
 * before anything takes its processes over.
 */
export class StoppedBackgroundTasks {
  /** Sessions whose notice waits for their host to come back from an update, and whether it is due. */
  private readonly held = new Map<string, boolean>();
  /** Sessions someone stopped on purpose, told only when they next start. */
  private readonly stoppedOnPurpose = new Set<string>();

  constructor(private readonly deps: StoppedBackgroundTasksDeps) {}

  /** The session's live Claude process listed every background task it runs now. */
  reported(sessionId: string, tasks: readonly BackgroundTaskInfo[]): void {
    const info = this.deps.session(sessionId);
    if (!info) return;
    // A process taken over after a server restart reports no nesting for tasks it started before.
    const before = new Map((info.liveBackgroundTasks ?? []).map((task) => [task.id, task]));
    const live = tasks.map(
      (task): LiveBackgroundTask => ({
        id: task.taskId,
        description: task.description,
        kind: task.kind ?? "other",
        ...(task.nested || before.get(task.taskId)?.nested ? { nested: true } : {}),
      }),
    );
    if (live.length === 0 && !info.liveBackgroundTasks) return;
    if (live.length === 0) delete info.liveBackgroundTasks;
    else info.liveBackgroundTasks = live;
    this.deps.persist();
  }

  /** Someone is stopping the session on purpose: leave it stopped, and tell it when it next starts. */
  stoppingOnPurpose(sessionId: string): void {
    this.stoppedOnPurpose.add(sessionId);
  }

  /** The session's Claude process ended: tell the session (starting it again) which of its tasks stopped. */
  processEnded(sessionId: string): void {
    if (this.stoppedOnPurpose.has(sessionId)) return;
    if (this.held.has(sessionId)) {
      if (this.deps.session(sessionId)?.liveBackgroundTasks) this.held.set(sessionId, true);
      return;
    }
    this.tell(sessionId);
  }

  /** A new Claude process started for the session without taking the old one over: tell it what stopped. */
  processStarted(sessionId: string): void {
    this.stoppedOnPurpose.delete(sessionId);
    this.tell(sessionId);
  }

  /**
   * The session's host is about to restart for an update: tell the session
   * only once it is back ({@link release}), so it does not start again on the
   * instance that is about to end.
   */
  hold(sessionId: string): void {
    if (!this.held.has(sessionId)) this.held.set(sessionId, false);
  }

  /** The host is back (or its update is off): deliver what was held. */
  release(sessionId: string): void {
    const due = this.held.get(sessionId);
    this.held.delete(sessionId);
    if (due) this.processEnded(sessionId);
  }

  /** Send the session the notice of the tasks its last process reported, once. */
  private tell(sessionId: string): void {
    const info = this.deps.session(sessionId);
    if (!info?.liveBackgroundTasks || this.deps.stopping()) return;
    const tasks = info.liveBackgroundTasks;
    delete info.liveBackgroundTasks;
    this.deps.persist();
    if (info.archived) return;
    console.log(
      `[server] Session ${sessionTag(sessionId)} lost ${tasks.length} background task(s) with its process; telling it`,
    );
    this.deps.deliver(sessionId, stoppedBackgroundTasksNotice(tasks));
  }
}
