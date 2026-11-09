/** A sub-agent (resumable after its process ends), a shell command, or another kind of background task. */
export type BackgroundTaskKind = "agent" | "shell" | "other";

/** A background task a session's Claude process last reported running, kept with the session. */
export interface LiveBackgroundTask {
  /** Claude's task id; for a sub-agent, the agent id `SendMessage` resumes it by. */
  id: string;
  description: string;
  kind: BackgroundTaskKind;
  /** A sub-agent started by another sub-agent. */
  nested?: boolean;
}

/** What the session reads: the sub-agents it can resume, and the rest it can only rerun. */
export function stoppedBackgroundTasksNotice(tasks: readonly LiveBackgroundTask[]): string {
  const line = (task: LiveBackgroundTask) => `- ${task.description || "(no description)"}`;
  const agents = tasks.filter((task) => task.kind === "agent" && !task.nested);
  const nested = tasks.filter((task) => task.kind === "agent" && task.nested);
  const others = tasks.filter((task) => task.kind !== "agent");
  const parts = [
    "Your Claude process ended (for example for a Takode restart or update), and the background tasks it ran stopped with it. Nothing you did caused this.",
  ];
  if (agents.length > 0) {
    parts.push(
      [
        "These sub-agents stopped; their transcripts are kept. Resume each one you still need with `SendMessage` to its ID, and tell it to check what it already did before redoing anything: the step it was in may have partly run.",
        ...agents.map((task) => `- \`${task.id}\`: ${task.description || "(no description)"}`),
      ].join("\n"),
    );
  }
  if (nested.length > 0) {
    parts.push(
      `${nested.length === 1 ? "1 sub-agent" : `${nested.length} sub-agents`} that your sub-agents started stopped too; a resumed sub-agent can resume its own.`,
    );
  }
  if (others.length > 0) {
    parts.push(
      [
        "These background commands stopped and cannot be resumed; rerun the ones you still need:",
        ...others.map(line),
      ].join("\n"),
    );
  }
  return parts.join("\n\n");
}
