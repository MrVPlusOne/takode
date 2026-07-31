import type {
  BrowserIncomingMessage,
  CodexAutoPauseHeldInput,
  CodexAutoPauseRecoveryLink,
  CodexAutoPauseRecoveryOutcome,
  CodexAutoPauseRecoveryReasonCode,
  CodexAutoPauseRecoveryReceipt,
  CodexOutboundTurn,
  CodexResultErrorAutoPauseState,
  PendingCodexInput,
  ThreadRef,
} from "../session-types.js";
import { buildCodexAutoPauseRecoverySearchText } from "../codex-auto-pause-types.js";

type RecoverySummaryEntry = Extract<BrowserIncomingMessage, { type: "codex_auto_pause_recovery_summary" }>;

interface RecoverySummarySessionLike {
  messageHistory: BrowserIncomingMessage[];
}

interface RecoverySummaryDeps {
  broadcastToBrowsers: (session: any, message: BrowserIncomingMessage) => void;
}

const SOURCE_LABEL_MAX = 64;
const SOURCE_DETAIL_MAX = 96;

const REASONS: Record<CodexAutoPauseRecoveryReasonCode, string> = {
  manual_recovery_succeeded: "Manual recovery succeeded; queued for exact-once delivery.",
  codex_delivery_accepted: "Accepted by Codex exactly once.",
  codex_delivery_completed: "Accepted by Codex exactly once and the turn completed.",
  codex_delivery_recovered: "Accepted by Codex exactly once and completed after automatic turn recovery.",
  codex_delivery_completed_with_error: "Accepted by Codex exactly once; the backend turn later returned an error.",
  stale_board_state: "Suppressed because the authoritative board state no longer matched the stalled event.",
  superseded_board_state: "Suppressed because a newer turn outcome superseded the stalled event.",
  explicit_cancel: "Discarded by an explicit pending-input cancellation.",
  pending_input_too_large: "Failed because the released input exceeded the bounded Codex delivery limit.",
  delivery_pipeline_rejected: "Failed because the server could not admit the released input to pending delivery.",
  nonrecoverable_turn_start: "Failed because Codex rejected the input before starting a turn.",
};

export function createCodexAutoPauseRecoverySummary(
  session: RecoverySummarySessionLike,
  state: CodexResultErrorAutoPauseState,
  heldInputs: readonly CodexAutoPauseHeldInput[],
  now: number,
  deps: RecoverySummaryDeps,
): RecoverySummaryEntry {
  const id = `codex-auto-pause-recovery-${state.pausedAt ?? state.lastErrorAt}`;
  const existing = findRecoverySummary(session, id);
  if (existing) return existing;

  const recovery = {
    family: state.family,
    pausedAt: state.pausedAt ?? state.lastErrorAt,
    recoveryConfirmedAt: now,
    updatedAt: now,
    status: "releasing" as const,
    receipts: heldInputs.map((item) => buildReleasedReceipt(item, now)),
  };
  const route = collectHeldInputRoute(heldInputs);
  const entry: RecoverySummaryEntry = {
    type: "codex_auto_pause_recovery_summary",
    id,
    timestamp: now,
    content: buildRecoverySummaryContent(recovery.receipts),
    searchText: buildCodexAutoPauseRecoverySearchText(recovery),
    recovery,
    ...route,
  };
  session.messageHistory.push(entry);
  deps.broadcastToBrowsers(session, entry);
  return entry;
}

export function collectCodexAutoPauseRecoveryLinks(
  inputs: readonly Pick<PendingCodexInput, "autoPauseRecoveries">[],
): CodexAutoPauseRecoveryLink[] | undefined {
  const links = dedupeLinks(inputs.flatMap((input) => input.autoPauseRecoveries ?? []));
  return links.length > 0 ? links : undefined;
}

export function markCodexAutoPauseRecoveryDelivered(
  session: RecoverySummarySessionLike,
  links: readonly CodexAutoPauseRecoveryLink[] | undefined,
  now: number,
  deps: RecoverySummaryDeps,
): boolean {
  return links?.length
    ? updateRecoveryOutcomes(session, links, "delivered", "codex_delivery_accepted", now, deps)
    : false;
}

export function markCodexAutoPauseRecoverySuppressed(
  session: RecoverySummarySessionLike,
  links: readonly CodexAutoPauseRecoveryLink[],
  now: number,
  deps: RecoverySummaryDeps,
  reasonCode: Extract<
    CodexAutoPauseRecoveryReasonCode,
    "stale_board_state" | "superseded_board_state"
  > = "stale_board_state",
): boolean {
  return updateRecoveryOutcomes(session, links, "suppressed", reasonCode, now, deps);
}

export function markCodexAutoPauseRecoveryDiscarded(
  session: RecoverySummarySessionLike,
  links: readonly CodexAutoPauseRecoveryLink[] | undefined,
  now: number,
  deps: RecoverySummaryDeps,
): boolean {
  return links?.length ? updateRecoveryOutcomes(session, links, "discarded", "explicit_cancel", now, deps) : false;
}

export function markCodexAutoPauseRecoveryFailed(
  session: RecoverySummarySessionLike,
  links: readonly CodexAutoPauseRecoveryLink[],
  now: number,
  deps: RecoverySummaryDeps,
  reasonCode: Extract<
    CodexAutoPauseRecoveryReasonCode,
    "pending_input_too_large" | "delivery_pipeline_rejected" | "nonrecoverable_turn_start"
  > = "nonrecoverable_turn_start",
): boolean {
  return updateRecoveryOutcomes(session, links, "failed", reasonCode, now, deps);
}

export function markCodexAutoPauseRecoveryTurnCompleted(
  session: RecoverySummarySessionLike,
  turn: Pick<CodexOutboundTurn, "autoPauseRecoveryLinks" | "dispatchCount"> | null | undefined,
  isError: boolean,
  interrupted: boolean,
  now: number,
  deps: RecoverySummaryDeps,
): boolean {
  if (interrupted || !turn?.autoPauseRecoveryLinks?.length) return false;
  const recovered = turn.dispatchCount > 1;
  let changed = false;
  const touched = new Map<string, RecoverySummaryEntry>();
  for (const { summaryId, groupId } of dedupeLinks(turn.autoPauseRecoveryLinks)) {
    const entry = findRecoverySummary(session, summaryId);
    const receipt = entry?.recovery.receipts.find((item) => item.groupId === groupId);
    if (!entry || !receipt || receipt.outcome !== "delivered") continue;
    if (receipt.completedAt !== undefined && receipt.recovered === recovered && receipt.completionError === isError) {
      continue;
    }
    receipt.completedAt = now;
    receipt.recovered = recovered;
    receipt.completionError = isError;
    receipt.reasonCode = isError
      ? "codex_delivery_completed_with_error"
      : recovered
        ? "codex_delivery_recovered"
        : "codex_delivery_completed";
    receipt.reason = REASONS[receipt.reasonCode];
    entry.recovery.updatedAt = now;
    refreshRecoverySummaryEntry(entry);
    touched.set(summaryId, entry);
    changed = true;
  }
  for (const entry of touched.values()) deps.broadcastToBrowsers(session, entry);
  return changed;
}

function updateRecoveryOutcomes(
  session: RecoverySummarySessionLike,
  links: readonly CodexAutoPauseRecoveryLink[],
  outcome: Exclude<CodexAutoPauseRecoveryOutcome, "released_to_delivery">,
  reasonCode: CodexAutoPauseRecoveryReasonCode,
  now: number,
  deps: RecoverySummaryDeps,
): boolean {
  let changed = false;
  const touched = new Map<string, RecoverySummaryEntry>();
  for (const { summaryId, groupId } of dedupeLinks(links)) {
    const entry = findRecoverySummary(session, summaryId);
    const receipt = entry?.recovery.receipts.find((item) => item.groupId === groupId);
    if (!entry || !receipt || receipt.outcome !== "released_to_delivery") continue;
    receipt.outcome = outcome;
    receipt.reasonCode = reasonCode;
    receipt.reason = REASONS[reasonCode];
    receipt.terminalAt = now;
    entry.recovery.updatedAt = now;
    touched.set(summaryId, entry);
    changed = true;
  }
  for (const entry of touched.values()) {
    entry.recovery.status = entry.recovery.receipts.every((item) => item.outcome !== "released_to_delivery")
      ? "settled"
      : "releasing";
    refreshRecoverySummaryEntry(entry);
    deps.broadcastToBrowsers(session, entry);
  }
  return changed;
}

function buildReleasedReceipt(item: CodexAutoPauseHeldInput, now: number): CodexAutoPauseRecoveryReceipt {
  const count = Math.max(1, item.count);
  const coalescedCount = Math.max(0, count - 1);
  return {
    groupId: item.id,
    source: item.source,
    sourceLabel: sourceLabel(item),
    ...(sourceDetail(item) ? { sourceDetail: sourceDetail(item) } : {}),
    count,
    coalescedCount,
    ...(coalescedCount > 0 ? { survivingGroupId: item.id } : {}),
    queuedAt: item.queuedAt,
    lastQueuedAt: item.lastQueuedAt,
    releasedAt: now,
    outcome: "released_to_delivery",
    reasonCode: "manual_recovery_succeeded",
    reason: REASONS.manual_recovery_succeeded,
  };
}

function sourceLabel(item: CodexAutoPauseHeldInput): string {
  if (item.message.takodeHerdBatch || item.message.agentSource?.sessionId === "herd-events") return "Herd Events";
  const sourceId = item.message.agentSource?.sessionId ?? "";
  if (sourceId.startsWith("timer:")) return "Timer";
  if (sourceId === "system" || sourceId.startsWith("system:")) return "Takode system";
  return boundedLabel(
    item.message.agentSource?.sessionLabel ??
      (item.source === "programmatic" ? "Automatic input" : "Browser programmatic input"),
    SOURCE_LABEL_MAX,
  );
}

function sourceDetail(item: CodexAutoPauseHeldInput): string | undefined {
  const kinds = [
    ...new Set(
      (item.message.takodeHerdBatch?.events ?? [])
        .map((event) => boundedLabel(String(event.event ?? ""), 32))
        .filter(Boolean),
    ),
  ].slice(0, 3);
  if (kinds.length > 0) return boundedLabel(kinds.join(", "), SOURCE_DETAIL_MAX);
  return undefined;
}

function boundedLabel(value: string, maxLength: number): string {
  return value
    .replace(
      /\b(authorization|api[-_ ]?key|bearer|access[-_ ]?token|refresh[-_ ]?token)\b(?:\s*[:=]\s*|\s+)[^\s|,;]+/giu,
      "$1 [redacted]",
    )
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

function collectHeldInputRoute(
  heldInputs: readonly CodexAutoPauseHeldInput[],
): Pick<RecoverySummaryEntry, "threadKey" | "questId" | "threadRefs"> {
  const refs = new Map<string, ThreadRef>();
  for (const item of heldInputs) {
    const message = item.message;
    for (const ref of message.threadRefs ?? []) refs.set(ref.threadKey.toLowerCase(), ref);
    if (message.threadKey) {
      refs.set(message.threadKey.toLowerCase(), {
        threadKey: message.threadKey,
        ...(message.questId ? { questId: message.questId } : {}),
        source: "explicit",
      });
    } else if (message.questId) {
      refs.set(message.questId.toLowerCase(), {
        threadKey: message.questId,
        questId: message.questId,
        source: "explicit",
      });
    }
  }
  const threadRefs = [...refs.values()];
  if (threadRefs.length !== 1) return threadRefs.length > 0 ? { threadRefs } : {};
  const [only] = threadRefs;
  return {
    threadKey: only!.threadKey,
    ...(only!.questId ? { questId: only!.questId } : {}),
    threadRefs,
  };
}

function buildRecoverySummaryContent(receipts: readonly CodexAutoPauseRecoveryReceipt[]): string {
  const counts = new Map<CodexAutoPauseRecoveryOutcome, number>();
  for (const receipt of receipts) counts.set(receipt.outcome, (counts.get(receipt.outcome) ?? 0) + 1);
  const labels: Array<[CodexAutoPauseRecoveryOutcome, string]> = [
    ["delivered", "delivered"],
    ["suppressed", "suppressed"],
    ["discarded", "discarded"],
    ["failed", "failed"],
    ["released_to_delivery", "awaiting delivery"],
  ];
  const details = labels
    .flatMap(([outcome, label]) => {
      const count = counts.get(outcome) ?? 0;
      return count > 0 ? [`${count} ${label}`] : [];
    })
    .join(", ");
  return `Automatic input recovery: ${details || "no held inputs"}.`;
}

function refreshRecoverySummaryEntry(entry: RecoverySummaryEntry): void {
  entry.content = buildRecoverySummaryContent(entry.recovery.receipts);
  entry.searchText = buildCodexAutoPauseRecoverySearchText(entry.recovery);
}

function findRecoverySummary(session: RecoverySummarySessionLike, id: string): RecoverySummaryEntry | undefined {
  return session.messageHistory.find(
    (message): message is RecoverySummaryEntry =>
      message.type === "codex_auto_pause_recovery_summary" && message.id === id,
  );
}

function dedupeLinks(links: readonly CodexAutoPauseRecoveryLink[]): CodexAutoPauseRecoveryLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${link.summaryId}\u0000${link.groupId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
