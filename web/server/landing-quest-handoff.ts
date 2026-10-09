import type { LandingCommitMapping, LandingEntry } from "../shared/landing-queue.js";
import type { BoardRow, BoardRowLanding, ParkedQuestCompletion } from "./session-types.js";

const TAG = "[Landing queue]";

export interface LandedDeliveryInput {
  questId: string;
  leaderSessionId: string;
  workerSessionId: string;
  workPhaseOccurrenceId: string;
  preparationId?: string;
  branch: string;
  /** The pushed tip that contains the landed commits. */
  tip: string;
  mapping: LandingCommitMapping[];
}

export interface LandingQuestHandoffDeps {
  /** Active (not completed) board rows of every leader. */
  activeRows(): Array<{ leaderSessionId: string; row: BoardRow }>;
  updateRow(leaderSessionId: string, row: Omit<BoardRow, "createdAt" | "updatedAt">): void;
  getEntry(entryId: string): Promise<LandingEntry | undefined>;
  /**
   * Record landed commits as the Work occurrence's code delivery, as the Work
   * -> Memory transition records synced commits. Returns the delivery ID, and
   * a note when something had to be left out.
   */
  recordDelivery(input: LandedDeliveryInput): Promise<{ deliveryId: string; note?: string }>;
  /** Complete the quest with final Memory's parked completion. */
  completeQuest(questId: string, completion: ParkedQuestCompletion, workerSessionId: string): Promise<void>;
  notify(sessionId: string, text: string): void;
}

/**
 * Moves quests through the Landing phase. A worker submits its change, hands
 * the quest to Memory with the landing entry, and is done after final Memory;
 * the quest waits in Landing. This records the landed commits as the quest's
 * Work delivery and applies final Memory's completion when the change lands,
 * or keeps the quest in Landing as bounced, with a Work and a Memory occurrence
 * added after it, and tells the leader, who routes the fix.
 */
export class LandingQuestHandoff {
  private recording = new Set<string>();

  constructor(private deps: LandingQuestHandoffDeps) {}

  /**
   * The landing queue reports an entry's outcome here first. Returns true when
   * the queue's own message to the owner is not needed.
   */
  async entryResolved(entry: LandingEntry): Promise<boolean> {
    const match = this.findByEntry(entry.id);
    if (!match) return this.outcomeBeforeHandOff(entry);
    const { leaderSessionId, row } = match;
    const landing = row.landing!;
    const worker = landing.workerSessionId;
    if (entry.state === "landed") {
      if (landing.outcome !== "landed") {
        this.patchLanding(leaderSessionId, row, { outcome: "landed" });
        if (isStatus(row, "MEMORY"))
          this.deps.notify(
            worker,
            [
              `${TAG} Your change for ${row.questId} landed on ${landing.branch}. Target SHAs in order: ${targets(entry)}`,
              "",
              "Takode records them as the quest's Work delivery. Finish Memory as usual; completing it then completes the quest.",
            ].join("\n"),
          );
      }
      await this.recordLanded(entry);
      return true;
    }
    if (entry.state !== "bounced" && entry.state !== "withdrawn") return false;
    if (landing.outcome === entry.state) return true;
    this.patchLanding(leaderSessionId, row, {
      outcome: entry.state,
      ...(entry.reason ? { reason: entry.reason } : {}),
    });
    if (isStatus(row, "LANDING")) this.routeBounce(row.questId, entry);
    else if (isStatus(row, "MEMORY"))
      this.deps.notify(
        worker,
        [
          `${TAG} Your change for ${row.questId} ${outcomeText(entry)} and did not land. Reason: ${entry.reason ?? "none recorded"}`,
          ...details(entry),
          "",
          `Finish Memory as usual. Completing it keeps the quest open in Landing as ${entry.state}, and your leader decides who fixes it and when; \`takode land resume ${entry.id}\` restores the change.`,
        ].join("\n"),
      );
    return true;
  }

  /** Handle an entry whose outcome may have arrived before its quest was handed to Memory. */
  async catchUp(entryId: string): Promise<void> {
    const entry = await this.deps.getEntry(entryId);
    if (entry && ["landed", "bounced", "withdrawn"].includes(entry.state)) await this.entryResolved(entry);
  }

  /**
   * Final Memory completed for a quest whose change has not landed (or whose
   * landing is not recorded yet): keep the completion and move the quest to
   * Landing. Returns null when the quest should complete now instead.
   */
  park(
    questId: string,
    completion: ParkedQuestCompletion,
  ): { entryId: string; outcome: string; branch: string; tip: string } | null {
    const match = this.deps
      .activeRows()
      .find(({ row }) => row.questId.toLowerCase() === questId.toLowerCase() && row.landing);
    if (!match || match.row.landing!.deliveryId) return null;
    const { leaderSessionId, row } = match;
    const landing = row.landing!;
    const journey = row.journey!;
    const memoryIndex = journey.activePhaseIndex ?? journey.phaseIds.indexOf("memory");
    const landingIndex = journey.phaseIds.indexOf("landing", memoryIndex + 1);
    const phaseIds =
      landingIndex >= 0
        ? journey.phaseIds
        : [
            ...journey.phaseIds.slice(0, memoryIndex + 1),
            "landing" as const,
            ...journey.phaseIds.slice(memoryIndex + 1),
          ];
    this.deps.updateRow(leaderSessionId, {
      questId: row.questId,
      status: "LANDING",
      journey: {
        ...journey,
        phaseIds,
        activePhaseIndex: landingIndex >= 0 ? landingIndex : memoryIndex + 1,
        currentPhaseId: "landing",
      },
      landing: { ...landing, completion },
    });
    if (landing.outcome === "bounced" || landing.outcome === "withdrawn") {
      void this.deps.getEntry(landing.entryId).then((entry) => entry && this.routeBounce(row.questId, entry));
    } else {
      // An outcome that raced the hand-off, or a landing whose recording failed, is picked up now.
      setTimeout(() => void this.catchUp(landing.entryId).catch(logError), 0);
    }
    return {
      entryId: landing.entryId,
      outcome: landing.outcome ?? "waiting",
      branch: landing.branch,
      tip: landing.tip,
    };
  }

  /** Retry recordings that failed and pick up outcomes missed while the server was down. */
  async retryPending(): Promise<void> {
    for (const { row } of this.deps.activeRows()) {
      const landing = row.landing;
      if (!landing || landing.outcome === "bounced" || landing.outcome === "withdrawn") continue;
      if (landing.deliveryId && !isStatus(row, "LANDING")) continue;
      await this.catchUp(landing.entryId).catch(logError);
    }
  }

  private async recordLanded(entry: LandingEntry): Promise<void> {
    if (this.recording.has(entry.id)) return;
    this.recording.add(entry.id);
    try {
      let match = this.findByEntry(entry.id);
      if (!match) return;
      const landing = match.row.landing!;
      if (!landing.deliveryId) {
        try {
          const recorded = await this.deps.recordDelivery({
            questId: match.row.questId,
            leaderSessionId: match.leaderSessionId,
            workerSessionId: landing.workerSessionId,
            workPhaseOccurrenceId: landing.workPhaseOccurrenceId,
            ...(landing.preparationId ? { preparationId: landing.preparationId } : {}),
            branch: landing.branch,
            tip: entry.pushedTip ?? entry.mapping!.at(-1)!.target,
            mapping: entry.mapping ?? [],
          });
          match = this.findByEntry(entry.id);
          if (!match) return;
          this.patchLanding(match.leaderSessionId, match.row, {
            deliveryId: recorded.deliveryId,
            recordError: undefined,
          });
          if (recorded.note)
            this.deps.notify(
              match.leaderSessionId,
              `${TAG} ${match.row.questId}: the landed commits were ${recorded.note}.`,
            );
        } catch (error) {
          this.recordFailed(entry, `could not record the landed commits as its Work delivery: ${errorText(error)}`);
          return;
        }
      }
      await this.finishParked(entry);
    } finally {
      this.recording.delete(entry.id);
    }
  }

  /** Apply final Memory's completion to a quest in Landing whose landed commits are recorded. */
  private async finishParked(entry: LandingEntry): Promise<void> {
    const match = this.findByEntry(entry.id);
    const landing = match?.row.landing;
    if (!match || !landing?.deliveryId || !landing.completion || !isStatus(match.row, "LANDING")) return;
    try {
      await this.deps.completeQuest(match.row.questId, landing.completion, landing.workerSessionId);
    } catch (error) {
      this.recordFailed(entry, `could not be completed: ${errorText(error)}`);
      return;
    }
    const questId = match.row.questId;
    this.deps.notify(
      match.leaderSessionId,
      [
        `${TAG} ${questId} landed on ${landing.branch} and Takode completed it with final Memory's results.`,
        `Target SHAs in order: ${targets(entry)}`,
        `Delivery ${landing.deliveryId}: \`quest commit-links ${questId} --delivery ${landing.deliveryId}\``,
      ].join("\n"),
    );
  }

  /** Keep the quest in Landing, add the fix's Work and Memory occurrences after it, and tell the leader. */
  private routeBounce(questId: string, entry: LandingEntry): void {
    const match = this.deps
      .activeRows()
      .find(({ row }) => row.questId.toLowerCase() === questId.toLowerCase() && row.landing?.entryId === entry.id);
    if (!match?.row.journey || !isStatus(match.row, "LANDING")) return;
    const { leaderSessionId, row } = match;
    const journey = row.journey!;
    const landingIndex = journey.activePhaseIndex ?? journey.phaseIds.lastIndexOf("landing");
    if (journey.phaseIds[landingIndex + 1] !== "work") {
      this.deps.updateRow(leaderSessionId, {
        questId: row.questId,
        journey: {
          ...journey,
          phaseIds: [
            ...journey.phaseIds.slice(0, landingIndex + 1),
            "work",
            "memory",
            ...journey.phaseIds.slice(landingIndex + 1),
          ],
          revisionReason: `The landing queue ${outcomeText(entry)} the change; its fix runs in a new Work occurrence.`,
        },
      });
    }
    this.deps.notify(
      leaderSessionId,
      [
        `${TAG} ${questId}'s change ${outcomeText(entry)} and did not land. Reason: ${entry.reason ?? "none recorded"}`,
        ...details(entry),
        "",
        `${questId} stays in Landing on your board, with a Work and a Memory occurrence added after it. Decide who fixes it and when (the Landing leader brief, ~/.companion/quest-journey-phases/landing/leader.md, covers the choices). When the fixer is ready, \`takode board advance ${questId}\` starts the next Work occurrence; the fixer restores the change with \`takode land resume ${entry.id}\`.`,
      ].join("\n"),
    );
  }

  private recordFailed(entry: LandingEntry, problem: string): void {
    const match = this.findByEntry(entry.id);
    if (!match) return;
    const first = !match.row.landing!.recordError;
    this.patchLanding(match.leaderSessionId, match.row, { recordError: problem });
    if (first)
      this.deps.notify(
        match.leaderSessionId,
        `${TAG} ${match.row.questId}'s change landed on ${match.row.landing!.branch} (target SHAs ${targets(entry)}) but ${problem}. Takode retries every few minutes.`,
      );
  }

  /** An outcome for a quest that was not handed to Memory with this entry yet. */
  private outcomeBeforeHandOff(entry: LandingEntry): boolean {
    if (entry.state !== "landed" || !entry.questId) return false;
    this.deps.notify(
      entry.sessionId,
      [
        `${TAG} Your change for ${entry.questId} landed on ${entry.target.branch}. Target SHAs in order: ${targets(entry)}`,
        "",
        `Hand the quest to Memory with \`takode board work-to-memory ${entry.questId} --work-note <index> --landing-entry ${entry.id}\`; Takode records the landed commits as the Work delivery.`,
      ].join("\n"),
    );
    return true;
  }

  private findByEntry(entryId: string): { leaderSessionId: string; row: BoardRow } | undefined {
    return this.deps.activeRows().find(({ row }) => row.landing?.entryId === entryId);
  }

  private patchLanding(leaderSessionId: string, row: BoardRow, patch: Partial<BoardRowLanding>): void {
    const landing = { ...row.landing!, ...patch };
    for (const key of Object.keys(patch) as (keyof BoardRowLanding)[])
      if (patch[key] === undefined) delete landing[key];
    this.deps.updateRow(leaderSessionId, { questId: row.questId, landing });
  }
}

function isStatus(row: BoardRow, status: string): boolean {
  return (row.status ?? "").trim().toUpperCase() === status;
}

function outcomeText(entry: LandingEntry): string {
  return entry.state === "withdrawn" ? "was withdrawn" : "bounced";
}

function targets(entry: LandingEntry): string {
  return (entry.mapping ?? []).map((commit) => commit.target).join(",");
}

function details(entry: LandingEntry): string[] {
  return entry.details ? ["", "```", entry.details.slice(-2000), "```"] : [];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logError(error: unknown): void {
  console.warn("[landing-quest-handoff]", error);
}
