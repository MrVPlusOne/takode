import { createHash, randomBytes } from "node:crypto";
import type {
  QuestOutcomeActor,
  QuestOutcomeAnchor,
  QuestOutcomePreview,
  QuestOutcomeRevision,
  QuestOutcomeSource,
  QuestOutcomeState,
  QuestmasterTask,
} from "./quest-types.js";

const SUMMARY_TARGET_CHARS = 420;
const QUEST_QUIZ_DIRECTIVE_RE = /^\s*\{\[\(Quest Quiz:\s*q-\d+\)\]\}\s*$/i;
const THREAD_STATUS_DIRECTIVE_RE = /^\s*\{\[\(Thread (?:Waiting|Ready):\s*(?:main|q-\d+)\s*\|[^\r\n]+\)\]\}\s*$/i;
const THREAD_ROUTE_DIRECTIVE_RE = /^\s*\[thread:(?:main|q-\d+)\]\s*$/i;
const SHELL_THREAD_ROUTE_DIRECTIVE_RE = /^\s*#\s*thread:(?:main|q-\d+)\s*$/i;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

export interface QuestOutcomeRevisionInput {
  baseRevisionId: string | null;
  markdown: string;
  summaryMarkdown?: string;
  actor: QuestOutcomeActor;
  anchor?: QuestOutcomeAnchor;
  sources: QuestOutcomeSource[];
  idempotencyKey?: string;
  idempotencyHash?: string;
}

export interface QuestOutcomeRevisionOptions {
  now?: number;
  revisionId?: string;
}

export class QuestOutcomeIdempotencyConflictError extends Error {
  constructor() {
    super("Quest Outcome idempotency key was already used for a different revision payload.");
    this.name = "QuestOutcomeIdempotencyConflictError";
  }
}

export class QuestOutcomeConflictError extends Error {
  constructor(readonly currentRevisionId: string | null) {
    super(
      currentRevisionId
        ? `Quest Outcome changed; retry against current revision ${currentRevisionId}.`
        : "Quest Outcome changed; retry against the current empty state.",
    );
    this.name = "QuestOutcomeConflictError";
  }
}

export function questOutcomeContentHash(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

function readFence(line: string): { marker: "`" | "~"; length: number } | null {
  const match = line.match(FENCE_RE);
  if (!match) return null;
  const token = match[1]!;
  return { marker: token[0] as "`" | "~", length: token.length };
}

function isOutcomeDirectiveLine(line: string): boolean {
  return (
    QUEST_QUIZ_DIRECTIVE_RE.test(line) ||
    THREAD_STATUS_DIRECTIVE_RE.test(line) ||
    THREAD_ROUTE_DIRECTIVE_RE.test(line) ||
    SHELL_THREAD_ROUTE_DIRECTIVE_RE.test(line)
  );
}

/** Remove structural feed directives while preserving literal examples inside fenced code. */
export function normalizeQuestOutcomeMarkdown(markdown: string): string {
  const kept: string[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;

  for (const rawLine of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const currentFence = readFence(rawLine);
    if (fence) {
      kept.push(rawLine);
      if (currentFence && currentFence.marker === fence.marker && currentFence.length >= fence.length) fence = null;
      continue;
    }
    if (currentFence) {
      fence = currentFence;
      kept.push(rawLine);
      continue;
    }
    if (!isOutcomeDirectiveLine(rawLine)) kept.push(rawLine);
  }

  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hasSubstantiveQuestOutcome(markdown: string): boolean {
  const normalized = normalizeQuestOutcomeMarkdown(markdown);
  if (!normalized) return false;
  const readable = normalized
    .replace(/<!--[^]*?-->/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#~|\-+=:[\](){}.!?,;\\/]/g, " ");
  return /[\p{L}\p{N}]/u.test(readable);
}

function markdownBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const current: string[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;

  const flush = () => {
    const block = current.join("\n").trim();
    current.length = 0;
    if (block) blocks.push(block);
  };

  for (const line of markdown.split("\n")) {
    const currentFence = readFence(line);
    if (fence) {
      current.push(line);
      if (currentFence && currentFence.marker === fence.marker && currentFence.length >= fence.length) fence = null;
      continue;
    }
    if (currentFence) {
      fence = currentFence;
      current.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

/** Derive a compact preview without cutting a Markdown block in the middle. */
export function deriveQuestOutcomeSummary(markdown: string): string {
  const normalized = normalizeQuestOutcomeMarkdown(markdown);
  if (!hasSubstantiveQuestOutcome(normalized)) return "";
  if (normalized.length <= SUMMARY_TARGET_CHARS) return normalized;

  const blocks = markdownBlocks(normalized);
  const selected: string[] = [];
  for (const block of blocks) {
    const candidate = [...selected, block].join("\n\n");
    const selectedHasNarrative = selected.some((part) => !/^#{1,6}\s+[^\n]+$/.test(part));
    if (selected.length > 0 && selectedHasNarrative && candidate.length > SUMMARY_TARGET_CHARS) break;
    selected.push(block);
    const candidateHasNarrative = selected.some((part) => !/^#{1,6}\s+[^\n]+$/.test(part));
    if (selected.length >= 2 && candidateHasNarrative && candidate.length >= SUMMARY_TARGET_CHARS * 0.6) break;
  }
  return (selected.length > 0 ? selected : blocks.slice(0, 1)).join("\n\n");
}

function normalizedAnchor(value: QuestOutcomeAnchor | undefined): QuestOutcomeAnchor | undefined {
  if (!value || !value.sessionId?.trim() || !Number.isInteger(value.historyIndex) || value.historyIndex < 0) {
    return undefined;
  }
  return {
    sessionId: value.sessionId.trim(),
    historyIndex: value.historyIndex,
    ...(value.messageId?.trim() ? { messageId: value.messageId.trim() } : {}),
  };
}

export function currentQuestOutcomeRevision(
  outcome: QuestOutcomeState | null | undefined,
): QuestOutcomeRevision | null {
  if (!outcome) return null;
  return outcome.revisions.find((revision) => revision.revisionId === outcome.currentRevisionId) ?? null;
}

export function normalizeQuestOutcomeState(value: unknown): QuestOutcomeState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<QuestOutcomeState>;
  const seen = new Set<string>();
  const revisions = (Array.isArray(raw.revisions) ? raw.revisions : []).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const revision = candidate as Partial<QuestOutcomeRevision>;
    const revisionId = typeof revision.revisionId === "string" ? revision.revisionId.trim() : "";
    const markdown = typeof revision.markdown === "string" ? normalizeQuestOutcomeMarkdown(revision.markdown) : "";
    if (!revisionId || seen.has(revisionId) || !hasSubstantiveQuestOutcome(markdown)) return [];
    seen.add(revisionId);
    const summaryOverride =
      typeof revision.summaryMarkdown === "string" ? normalizeQuestOutcomeMarkdown(revision.summaryMarkdown) : "";
    const summaryMarkdown = hasSubstantiveQuestOutcome(summaryOverride)
      ? summaryOverride
      : deriveQuestOutcomeSummary(markdown);
    return [
      {
        revisionId,
        ...(typeof revision.parentRevisionId === "string" && revision.parentRevisionId.trim()
          ? { parentRevisionId: revision.parentRevisionId.trim() }
          : {}),
        markdown,
        summaryMarkdown,
        summarySource: revision.summarySource === "authored" && summaryOverride ? "authored" : "derived",
        contentHash:
          typeof revision.contentHash === "string" && revision.contentHash.trim()
            ? revision.contentHash.trim()
            : questOutcomeContentHash(markdown),
        createdAt: typeof revision.createdAt === "number" ? revision.createdAt : 0,
        actor:
          revision.actor?.kind === "leader"
            ? { ...revision.actor, kind: "leader" }
            : { ...revision.actor, kind: "human" },
        ...(normalizedAnchor(revision.anchor) ? { anchor: normalizedAnchor(revision.anchor) } : {}),
        sources: Array.isArray(revision.sources) ? revision.sources : [],
        ...(typeof revision.idempotencyKey === "string" && revision.idempotencyKey.trim()
          ? { idempotencyKey: revision.idempotencyKey.trim() }
          : {}),
        ...(typeof revision.idempotencyHash === "string" && revision.idempotencyHash.trim()
          ? { idempotencyHash: revision.idempotencyHash.trim() }
          : {}),
      } satisfies QuestOutcomeRevision,
    ];
  });
  if (revisions.length === 0) return undefined;
  const requestedCurrentId = typeof raw.currentRevisionId === "string" ? raw.currentRevisionId.trim() : "";
  const currentRevisionId = revisions.some((revision) => revision.revisionId === requestedCurrentId)
    ? requestedCurrentId
    : revisions.at(-1)!.revisionId;
  const finalizedRevisionId =
    typeof raw.finalizedRevisionId === "string" &&
    revisions.some((revision) => revision.revisionId === raw.finalizedRevisionId?.trim())
      ? raw.finalizedRevisionId.trim()
      : undefined;
  return {
    currentRevisionId,
    revisions,
    ...(finalizedRevisionId ? { finalizedRevisionId } : {}),
    ...(finalizedRevisionId && typeof raw.finalizedAt === "number" ? { finalizedAt: raw.finalizedAt } : {}),
    ...(typeof raw.reopenedAt === "number" ? { reopenedAt: raw.reopenedAt } : {}),
    ...(typeof raw.previousFinalRevisionId === "string" && raw.previousFinalRevisionId.trim()
      ? { previousFinalRevisionId: raw.previousFinalRevisionId.trim() }
      : {}),
  };
}

export function appendQuestOutcomeRevision(
  quest: QuestmasterTask,
  input: QuestOutcomeRevisionInput,
  options: QuestOutcomeRevisionOptions = {},
): QuestmasterTask {
  const currentOutcome = normalizeQuestOutcomeState(quest.outcome);
  const markdown = normalizeQuestOutcomeMarkdown(input.markdown);
  if (!hasSubstantiveQuestOutcome(markdown))
    throw new Error("Quest Outcome must contain substantive renderable Markdown.");
  const summaryOverride = normalizeQuestOutcomeMarkdown(input.summaryMarkdown ?? "");
  if (input.summaryMarkdown !== undefined && !hasSubstantiveQuestOutcome(summaryOverride)) {
    throw new Error("Custom Quest Outcome summary must contain substantive renderable Markdown.");
  }
  const summaryMarkdown = summaryOverride || deriveQuestOutcomeSummary(markdown);
  const anchor = normalizedAnchor(input.anchor);
  if (input.idempotencyKey) {
    const duplicate = currentOutcome?.revisions.find((revision) => revision.idempotencyKey === input.idempotencyKey);
    if (duplicate) {
      const samePayload =
        input.idempotencyHash && duplicate.idempotencyHash
          ? input.idempotencyHash === duplicate.idempotencyHash
          : duplicate.contentHash === questOutcomeContentHash(markdown) &&
            duplicate.summaryMarkdown === summaryMarkdown &&
            JSON.stringify(duplicate.anchor ?? null) === JSON.stringify(anchor ?? null) &&
            JSON.stringify(duplicate.actor) === JSON.stringify(input.actor) &&
            JSON.stringify(duplicate.sources) === JSON.stringify(input.sources);
      if (!samePayload) throw new QuestOutcomeIdempotencyConflictError();
      return quest;
    }
  }

  const currentRevision = currentQuestOutcomeRevision(currentOutcome);
  const currentRevisionId = currentRevision?.revisionId ?? null;
  if (input.baseRevisionId !== currentRevisionId) throw new QuestOutcomeConflictError(currentRevisionId);

  const now = options.now ?? Date.now();
  const revisionId = options.revisionId ?? `outcome-${now}-${randomBytes(4).toString("hex")}`;
  const revision: QuestOutcomeRevision = {
    revisionId,
    ...(currentRevision ? { parentRevisionId: currentRevision.revisionId } : {}),
    markdown,
    summaryMarkdown,
    summarySource: summaryOverride ? "authored" : "derived",
    contentHash: questOutcomeContentHash(markdown),
    createdAt: now,
    actor: input.actor,
    ...(anchor ? { anchor } : {}),
    sources: input.sources,
    ...(input.idempotencyKey?.trim() ? { idempotencyKey: input.idempotencyKey.trim() } : {}),
    ...(input.idempotencyHash?.trim() ? { idempotencyHash: input.idempotencyHash.trim() } : {}),
  };
  const completed = quest.status === "done" && quest.cancelled !== true;
  return {
    ...quest,
    updatedAt: now,
    ...(completed ? { debrief: markdown, debriefTldr: summaryMarkdown } : {}),
    outcome: {
      currentRevisionId: revisionId,
      revisions: [...(currentOutcome?.revisions ?? []), revision],
      ...(completed ? { finalizedRevisionId: revisionId, finalizedAt: now } : {}),
      ...(currentOutcome?.previousFinalRevisionId
        ? { previousFinalRevisionId: currentOutcome.previousFinalRevisionId }
        : {}),
    },
  } as QuestmasterTask;
}

export function finalizeQuestOutcome(
  outcome: QuestOutcomeState | undefined,
  now: number,
): QuestOutcomeState | undefined {
  const normalized = normalizeQuestOutcomeState(outcome);
  if (!normalized) return undefined;
  if (normalized.finalizedRevisionId === normalized.currentRevisionId) return normalized;
  return {
    ...normalized,
    finalizedRevisionId: normalized.currentRevisionId,
    finalizedAt: now,
  };
}

export function reopenQuestOutcome(outcome: QuestOutcomeState | undefined, now: number): QuestOutcomeState | undefined {
  const normalized = normalizeQuestOutcomeState(outcome);
  if (!normalized) return undefined;
  const { finalizedRevisionId, finalizedAt, ...active } = normalized;
  void finalizedAt;
  if (!finalizedRevisionId) return active;
  return {
    ...active,
    reopenedAt: now,
    previousFinalRevisionId: finalizedRevisionId,
  };
}

export function buildQuestOutcomePreview(
  outcome: QuestOutcomeState | undefined,
  options: { requireFinalized?: boolean } = {},
): QuestOutcomePreview | undefined {
  const normalized = normalizeQuestOutcomeState(outcome);
  const current = currentQuestOutcomeRevision(normalized);
  if (!normalized || !current) return undefined;
  if (options.requireFinalized && normalized.finalizedRevisionId !== current.revisionId) return undefined;
  return {
    currentRevisionId: current.revisionId,
    ...(normalized.finalizedRevisionId ? { finalizedRevisionId: normalized.finalizedRevisionId } : {}),
    summaryMarkdown: current.summaryMarkdown,
    updatedAt: current.createdAt,
    revisionCount: normalized.revisions.length,
    ...(normalized.reopenedAt !== undefined ? { reopenedAt: normalized.reopenedAt } : {}),
  };
}
