import type {
  QuestFeedbackEntry,
  QuestJourneyRun,
  QuestmasterTask,
  QuestRound,
  QuestRoundEdit,
  QuestRoundOpenInput,
} from "../server/quest-types.js";
import { indexedLiveQuestFeedbackEntries } from "./quest-feedback.js";

// ─── Quest rounds ────────────────────────────────────────────────────────────
//
// A quest that is reopened for each sequential step stays one quest and one
// conversation, but reads as a series of small quests: its rounds. Each round
// has its own title, brief, requests, phase notes, deliveries and outcome, so
// agents can read the open round and skip the rest.
//
// Only the rounds themselves are stored. Feedback, Journey runs and deliveries
// are placed by time: a round holds what happened from its opening until it
// closed, and anything that arrived after it closed belongs to the next round
// (it is what asked for it). Phase notes and deliveries follow their Journey
// run, since Memory and a landing-queue change finish after the round's Work,
// and a run belongs to the round it started in.
//
// Quests without stored rounds get one derived round per board Journey run,
// which is how they were reopened before rounds existed.

/** A round as agents and the UI read it. */
export interface QuestRoundView {
  /** One-based round number, stable for links (`quest:q-N:round:K`). */
  number: number;
  title: string;
  brief?: string;
  openedAt: number;
  closedAt?: number;
  open: boolean;
  /** Recorded from a Journey run rather than opened with a brief. */
  derived: boolean;
  /** The round's final debrief, when it has one. */
  outcome?: string;
  /** Scan summary of the outcome; falls back to the round's latest Work note. */
  outcomeTldr?: string;
  /** Human feedback that asked for the round. */
  requestIndices: number[];
  /** Every feedback entry in the round, requests and phase notes included. */
  feedbackIndices: number[];
  runIds: string[];
  deliveryIds: string[];
}

export interface QuestRoundsView {
  rounds: QuestRoundView[];
  /** Feedback that arrived after a done quest's last round closed: the next round's requests. */
  pendingFeedbackIndices: number[];
}

type RoundSource = Pick<QuestmasterTask, "createdAt" | "title" | "status" | "feedback" | "journeyRuns" | "rounds"> & {
  completedAt?: number;
  debrief?: string;
  debriefTldr?: string;
  cancelled?: boolean;
  codeDeliveries?: QuestmasterTask["codeDeliveries"];
};

/** The quest's rounds with their feedback, runs and deliveries. */
export function buildQuestRounds(quest: RoundSource): QuestRoundsView {
  const records = questRoundRecords(quest);
  const last = records.length - 1;
  const done = quest.status === "done";
  const closedAt = (index: number) =>
    records[index]!.closedAt ?? (index === last && done ? (quest.completedAt ?? quest.createdAt) : undefined);
  const roundAt = (ts: number): number => {
    let index = 0;
    while (index < last && records[index + 1]!.openedAt <= ts) index++;
    const closed = closedAt(index);
    return closed !== undefined && ts > closed ? index + 1 : index;
  };

  const runs = sortedRuns(quest.journeyRuns);
  const runRound = new Map(runs.map((run) => [run.runId, roundAt(run.createdAt)]));
  const views: QuestRoundView[] = records.map((record, index) => ({
    number: index + 1,
    title: record.title?.trim() || "",
    ...(record.brief?.trim() ? { brief: record.brief.trim() } : {}),
    openedAt: index === 0 ? Math.min(record.openedAt, quest.createdAt) : record.openedAt,
    ...(closedAt(index) !== undefined ? { closedAt: closedAt(index) } : {}),
    open: closedAt(index) === undefined,
    derived: record.derived === true,
    ...(record.outcome ? { outcome: record.outcome } : {}),
    ...(record.outcomeTldr ? { outcomeTldr: record.outcomeTldr } : {}),
    requestIndices: [],
    feedbackIndices: [],
    runIds: runs.filter((run) => runRound.get(run.runId) === index).map((run) => run.runId),
    deliveryIds: [],
  }));
  if (done && !quest.cancelled && !views[last]!.outcome) {
    const lastView = views[last]!;
    if (quest.debrief?.trim()) lastView.outcome = quest.debrief.trim();
    if (quest.debriefTldr?.trim()) lastView.outcomeTldr = quest.debriefTldr.trim();
  }

  // A phase note stays with its run's round, such as a Memory note written
  // after the round's Work ended, unless it was written in a later round: a
  // board row kept across a reopening carries one run into the next round.
  const noteRound = (entry: QuestFeedbackEntry): number | undefined => {
    const index = entry.journeyRunId ? runRound.get(entry.journeyRunId) : undefined;
    if (index === undefined || index > last) return undefined;
    return index === last || entry.ts < records[index + 1]!.openedAt ? index : undefined;
  };
  const pending: number[] = [];
  const explicitRequests = new Map<number, number>();
  records.forEach((record, index) => record.requests?.forEach((request) => explicitRequests.set(request, index)));
  for (const entry of indexedLiveQuestFeedbackEntries(quest.feedback)) {
    const index = explicitRequests.get(entry.index) ?? noteRound(entry) ?? roundAt(entry.ts);
    const view = views[index];
    if (!view) {
      pending.push(entry.index);
      continue;
    }
    view.feedbackIndices.push(entry.index);
    const askedBeforeOpening = entry.author === "human" && !entry.journeyRunId && entry.ts < view.openedAt;
    if (explicitRequests.get(entry.index) === index || askedBeforeOpening) view.requestIndices.push(entry.index);
  }

  // A delivery records its Work occurrence, and lands after Memory when it goes through the landing queue.
  for (const delivery of quest.codeDeliveries ?? []) {
    const run = runs.find((candidate) => delivery.phaseOccurrenceId.startsWith(`${candidate.runId}:`));
    views[Math.min(run ? runRound.get(run.runId)! : roundAt(delivery.recordedAt), last)]!.deliveryIds.push(delivery.id);
  }

  const feedback = quest.feedback ?? [];
  views.forEach((view, index) => {
    const notes = view.feedbackIndices.map((feedbackIndex) => feedback[feedbackIndex]!).filter(isWorkNote);
    if (!view.outcomeTldr && !view.open) {
      const summary = noteSummary(notes.at(-1));
      if (summary) view.outcomeTldr = summary;
    }
    if (!view.title)
      view.title =
        (records[index]!.derived && records.length > 1 ? roundTitle(noteSummary(notes[0])) : undefined) ??
        (index === 0 ? quest.title : `Round ${index + 1}`);
  });
  return { rounds: views, pendingFeedbackIndices: pending };
}

/** The stored rounds, or rounds derived from the quest's board Journey runs. */
export function questRoundRecords(quest: RoundSource): QuestRound[] {
  if (quest.rounds?.length) return quest.rounds;
  const runs = sortedRuns(quest.journeyRuns).filter((run) => run.source === "board");
  if (runs.length <= 1) return [{ openedAt: quest.createdAt, derived: true }];
  return runs.map((run, index) => {
    const next = runs[index + 1];
    // Feedback after a round's Work ended asked for the next round.
    const closedAt = next ? Math.min(lastWorkActivity(run, quest.feedback), next.createdAt) : undefined;
    return {
      openedAt: index === 0 ? quest.createdAt : run.createdAt,
      ...(closedAt !== undefined ? { closedAt } : {}),
      derived: true,
    };
  });
}

/**
 * The rounds after reopening: the latest round closes, keeping a done
 * quest's debrief as its outcome, and the new round opens. A quest without
 * stored rounds first gets its derived rounds recorded.
 */
export function reopenQuestRounds(quest: RoundSource, input: QuestRoundOpenInput, now: number): QuestRound[] {
  const rounds = questRoundRecords(quest).map((round) => ({ ...round }));
  const latest = rounds.at(-1)!;
  if (latest.closedAt === undefined)
    latest.closedAt = quest.status === "done" ? (quest.completedAt ?? now) : Math.max(now - 1, latest.openedAt);
  if (quest.status === "done" && !quest.cancelled && !latest.outcome) {
    if (quest.debrief?.trim()) latest.outcome = quest.debrief.trim();
    if (quest.debriefTldr?.trim()) latest.outcomeTldr = quest.debriefTldr.trim();
  }
  const title = input.title.trim();
  if (!title) throw new Error("A new round needs a title");
  const requests = [...new Set(input.requests ?? [])].sort((a, b) => a - b);
  for (const request of requests) {
    const entry = quest.feedback?.[request];
    if (!Number.isInteger(request) || !entry || typeof entry.deletedAt === "number")
      throw new Error(`Request #${request} is not a feedback entry of this quest`);
  }
  rounds.push({
    openedAt: now,
    title,
    ...(input.brief?.trim() ? { brief: input.brief.trim() } : {}),
    ...(requests.length ? { requests } : {}),
  });
  return rounds;
}

/** The rounds with one round retitled or its brief rewritten; derived rounds are recorded first. */
export function editQuestRound(quest: RoundSource, edit: QuestRoundEdit): QuestRound[] {
  const rounds = questRoundRecords(quest).map((round) => ({ ...round }));
  const round = Number.isInteger(edit.number) ? rounds[edit.number - 1] : undefined;
  if (!round) throw new Error(`Round ${edit.number} does not exist; this quest has ${rounds.length} round(s)`);
  if (edit.title !== undefined) {
    if (edit.title.trim()) round.title = edit.title.trim();
    else delete round.title;
  }
  if (edit.brief !== undefined) {
    if (edit.brief.trim()) round.brief = edit.brief.trim();
    else delete round.brief;
  }
  return rounds;
}

/** Round from a one-based number, or undefined when out of range. */
export function findQuestRound(view: QuestRoundsView, number: number): QuestRoundView | undefined {
  return Number.isInteger(number) ? view.rounds[number - 1] : undefined;
}

function sortedRuns(runs: QuestJourneyRun[] | undefined): QuestJourneyRun[] {
  return [...(runs ?? [])].sort((a, b) => a.createdAt - b.createdAt);
}

function lastWorkActivity(run: QuestJourneyRun, feedback: QuestFeedbackEntry[] | undefined): number {
  const times = [run.createdAt];
  for (const occurrence of run.phaseOccurrences) {
    if (occurrence.phaseId !== "work") continue;
    if (occurrence.startedAt) times.push(occurrence.startedAt);
    if (occurrence.completedAt) times.push(occurrence.completedAt);
  }
  for (const entry of feedback ?? [])
    if (entry.journeyRunId === run.runId && entry.phaseId === "work") times.push(entry.ts);
  return Math.max(...times);
}

function isWorkNote(entry: QuestFeedbackEntry | undefined): entry is QuestFeedbackEntry {
  return (
    entry?.author === "agent" &&
    entry.phaseId === "work" &&
    (entry.kind === undefined || entry.kind === "phase_summary" || entry.kind === "phase_finding")
  );
}

function noteSummary(entry: QuestFeedbackEntry | undefined): string | undefined {
  return (entry?.tldr?.trim() || entry?.text.trim()) ?? undefined;
}

const ROUND_TITLE_LIMIT = 90;

/** A short title from the first meaningful line of a Work note summary. */
export function roundTitle(summary: string | undefined): string | undefined {
  const line = summary
    ?.split("\n")
    .map((candidate) =>
      candidate
        .replace(/^\s*(?:[-*]|#+|\d+\.)\s+/, "")
        .replace(/\*\*|__|`/g, "")
        .replace(/^(?:Outcome|Work|Summary)(?: for [^:]+)?:\s*/i, "")
        .trim(),
    )
    .find((candidate) => candidate.length > 0 && !/^(?:Outcome|Work|Summary)\b.{0,30}$/i.test(candidate));
  if (!line) return undefined;
  const sentence = line.match(/^(.{20,}?[.;])(?:\s|$)/)?.[1]?.replace(/[.;]$/, "") ?? line;
  if (sentence.length <= ROUND_TITLE_LIMIT) return sentence;
  const cut = sentence.slice(0, ROUND_TITLE_LIMIT);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : cut.length).replace(/[,(:-]+$/, "")}…`;
}
