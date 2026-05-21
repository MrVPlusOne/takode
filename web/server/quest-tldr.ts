import type { QuestFeedbackEntry, QuestmasterTask } from "./quest-types.js";

export const TLDR_WARNING_THRESHOLD_CHARS = 1200;
export const QUEST_TLDR_WARNING_HEADER = "X-Quest-TLDR-Warning";

export type QuestTldrContentKind = "description" | "feedback" | "debrief";

const HASH_LIKE_TOKEN_RE = /\b[0-9a-f]{7,40}\b/gi;
const BOOKKEEPING_CONTEXT_RE =
  /\b(commit|commits|commitshas?|sha|shas|synced|sync|ported|port|pushed|push|merged|cherry[- ]?picked|main repo|worktree)\b/i;
const IDENTIFIER_SUBJECT_CONTEXT_RE =
  /\b(debug|debugged|debugging|investigat(?:e|ed|ing|ion)|bad|invalid|missing|broken|identifier|reference|hash parser|hash detection|hash-like|checksum|digest)\b/i;

export function normalizeTldr(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function hasLongContentWithoutTldr(text: unknown, tldr: unknown): boolean {
  if (typeof text !== "string") return false;
  if (normalizeTldr(tldr)) return false;
  return text.trim().length >= TLDR_WARNING_THRESHOLD_CHARS;
}

export function tldrWarningMessage(kind: QuestTldrContentKind): string {
  const label = kind === "description" ? "quest description" : kind === "feedback" ? "quest feedback" : "quest debrief";
  return `${label} is ${TLDR_WARNING_THRESHOLD_CHARS}+ characters; add separate tldr metadata for human scanning.`;
}

export function tldrHashBookkeepingWarningMessage(kind: QuestTldrContentKind): string {
  const label =
    kind === "description"
      ? "quest description TLDR"
      : kind === "feedback"
        ? "quest feedback TLDR"
        : "quest debrief TLDR";
  return `${label} appears to include raw commit/hash bookkeeping; keep TLDRs human-readable and put routine identifiers in structured commit metadata, dedicated Synced SHAs lines, detailed bodies, or verification sections. Keep exact identifiers only when the identifier is the subject.`;
}

export function hasLikelyHashBookkeepingInTldr(tldr: unknown): boolean {
  const text = normalizeTldr(tldr);
  if (!text) return false;

  for (const match of text.matchAll(HASH_LIKE_TOKEN_RE)) {
    const token = match[0];
    if (!/[a-f]/i.test(token)) continue;
    const matchIndex = match.index ?? 0;
    const start = Math.max(0, matchIndex - 80);
    const end = Math.min(text.length, matchIndex + token.length + 80);
    const context = text.slice(start, end);
    if (!BOOKKEEPING_CONTEXT_RE.test(context)) continue;
    if (IDENTIFIER_SUBJECT_CONTEXT_RE.test(context)) continue;
    return true;
  }

  return false;
}

export function tldrWarningsForContent(kind: QuestTldrContentKind, text: unknown, tldr: unknown): string[] {
  const warnings: string[] = [];
  if (hasLongContentWithoutTldr(text, tldr)) warnings.push(tldrWarningMessage(kind));
  if (hasLikelyHashBookkeepingInTldr(tldr)) warnings.push(tldrHashBookkeepingWarningMessage(kind));
  return warnings;
}

export function tldrWarningForContent(kind: QuestTldrContentKind, text: unknown, tldr: unknown): string | null {
  const warnings = tldrWarningsForContent(kind, text, tldr);
  return warnings.length > 0 ? warnings.join(" ") : null;
}

export function preferredQuestDescriptionPreview(quest: QuestmasterTask): string {
  return normalizeTldr((quest as { tldr?: unknown }).tldr) ?? ("description" in quest ? quest.description || "" : "");
}

export function preferredFeedbackPreview(entry: QuestFeedbackEntry): string {
  return normalizeTldr(entry.tldr) ?? entry.text;
}
