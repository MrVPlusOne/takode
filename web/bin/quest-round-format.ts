import type { QuestmasterTask } from "../server/quest-types.js";
import { indexedLiveQuestFeedbackEntries, type IndexedQuestFeedbackEntry } from "../shared/quest-feedback.js";
import { buildQuestRounds, type QuestRoundView, type QuestRoundsView } from "../shared/quest-rounds.js";

/** Formats one feedback entry as an indented preview line with its index. */
type EntryPreview = (entry: IndexedQuestFeedbackEntry) => string;

const EARLIER_ROUND_LIMIT = 10;

/** True when the quest has been reopened, so `quest show` reads it round by round. */
export function hasQuestRounds(quest: QuestmasterTask): QuestRoundsView | null {
  const view = buildQuestRounds(quest);
  return view.rounds.length > 1 ? view : null;
}

/**
 * The default `quest show` body of a reopened quest: the current round in
 * full and one line per earlier round, so its size stays flat as rounds pile up.
 */
export function formatCurrentRoundLines(
  quest: QuestmasterTask,
  view: QuestRoundsView,
  preview: EntryPreview,
  showAll: boolean,
): string[] {
  const current = view.rounds.at(-1)!;
  const lines = formatRoundBody(quest, current, preview, "compact");
  if (view.pendingFeedbackIndices.length > 0) {
    lines.push(`Since round ${current.number} closed (asks for the next round):`);
    for (const entry of entriesAt(quest, view.pendingFeedbackIndices)) lines.push(preview(entry));
  }
  const earlier = view.rounds.slice(0, -1).reverse();
  const shown = showAll ? earlier : earlier.slice(0, EARLIER_ROUND_LIMIT);
  lines.push(`Earlier rounds (${earlier.length}; reveal one with --round <n>):`);
  for (const round of shown) lines.push(`  ${roundLine(round)}`);
  if (shown.length < earlier.length)
    lines.push(`  ... ${earlier.length - shown.length} more: quest show ${quest.questId} --sections rounds`);
  return lines;
}

/** `quest show --round N`: one round in full. */
export function formatRoundDetailLines(quest: QuestmasterTask, number: number, preview: EntryPreview): string[] {
  const view = buildQuestRounds(quest);
  const round = view.rounds[number - 1];
  if (!round || !Number.isInteger(number))
    return [`Round ${number}: not found; ${quest.questId} has ${view.rounds.length} round(s).`];
  return formatRoundBody(quest, round, preview, "full");
}

/** One line per round for `--full`. */
export function formatAllRoundLines(view: QuestRoundsView): string[] {
  if (view.rounds.length < 2) return [];
  return [`Rounds: ${view.rounds.length}`, ...view.rounds.map((round) => `  ${roundLine(round)}`)];
}

function formatRoundBody(
  quest: QuestmasterTask,
  round: QuestRoundView,
  preview: EntryPreview,
  mode: "compact" | "full",
): string[] {
  const state = round.open
    ? `open since ${timeLabel(round.openedAt)}`
    : `${timeLabel(round.openedAt)} to ${timeLabel(round.closedAt!)}`;
  const derived = round.derived && mode === "full" ? ", recorded from its Journey run" : "";
  const lines = [`Round ${round.number} (${state}${derived}): ${round.title}`];
  if (round.brief) lines.push("  Brief:", ...indent(round.brief, "    "));
  const entries = entriesAt(quest, round.feedbackIndices);
  const requests = entries.filter((entry) => round.requestIndices.includes(entry.index));
  if (requests.length) lines.push("  Requests:", ...requests.map((entry) => `  ${preview(entry)}`));
  const rest = entries.filter((entry) => !round.requestIndices.includes(entry.index));
  const shown = mode === "full" ? rest : rest.filter((entry) => entry.phaseId);
  if (shown.length)
    lines.push(mode === "full" ? "  Feedback:" : "  Phase notes:", ...shown.map((entry) => `  ${preview(entry)}`));
  if (rest.length > shown.length)
    lines.push(
      `  ${rest.length - shown.length} other feedback entries: quest show ${quest.questId} --round ${round.number}`,
    );
  lines.push(...deliveryLines(quest, round, mode));
  const outcome = mode === "full" ? (round.outcome ?? round.outcomeTldr) : (round.outcomeTldr ?? round.outcome);
  if (outcome && !round.open) {
    if (mode === "full" && round.outcome && round.outcomeTldr)
      lines.push("  Outcome TLDR:", ...indent(round.outcomeTldr, "    "));
    lines.push("  Outcome:", ...indent(mode === "full" ? outcome : compact(outcome, 300), "    "));
  }
  return lines;
}

function deliveryLines(quest: QuestmasterTask, round: QuestRoundView, mode: "compact" | "full"): string[] {
  const deliveries = (quest.codeDeliveries ?? []).filter((delivery) => round.deliveryIds.includes(delivery.id));
  if (!deliveries.length) return [];
  const commits = deliveries.flatMap((delivery) => delivery.commits);
  if (mode === "compact") return [`  Delivered: ${commits.length} commit${commits.length === 1 ? "" : "s"}`];
  return [
    "  Delivered:",
    ...deliveries.flatMap((delivery) =>
      delivery.commits.map((commit) => `    ${commit.shortSha} ${commit.message} (delivery ${delivery.id})`),
    ),
  ];
}

function roundLine(round: QuestRoundView): string {
  const state = round.open ? "open" : dateLabel(round.closedAt ?? round.openedAt);
  return `${String(round.number).padStart(3)}  ${state.padEnd(6)}  ${round.title}`;
}

function entriesAt(quest: QuestmasterTask, indices: number[]): IndexedQuestFeedbackEntry[] {
  const wanted = new Set(indices);
  return indexedLiveQuestFeedbackEntries(quest.feedback).filter((entry) => wanted.has(entry.index));
}

function dateLabel(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function timeLabel(ts: number): string {
  const time = new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${dateLabel(ts)} ${time}`;
}

function indent(text: string, prefix: string): string[] {
  return text
    .trim()
    .split("\n")
    .map((line) => `${prefix}${line}`);
}

function compact(text: string, max: number): string {
  const single = text.trim().replace(/\s+/g, " ");
  return single.length <= max ? single : `${single.slice(0, max - 3).trimEnd()}...`;
}
