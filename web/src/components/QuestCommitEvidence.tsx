import { useId, useState } from "react";
import { QuestDisclosureChip } from "./QuestDisclosureChip.js";
import type { QuestCommitLookup } from "../api.js";

export type QuestCommitKind = "code" | "memory";

export interface QuestCommitEntry {
  kind: QuestCommitKind;
  sha: string;
  storedIndex: number;
}

interface QuestCommitEvidenceListProps {
  entries: QuestCommitEntry[];
  lookupByKey: Record<string, QuestCommitLookup>;
  onOpenCommit: (entry: QuestCommitEntry) => void;
}

export function commitLookupKey(kind: QuestCommitKind, sha: string): string {
  return `${kind}:${sha}`;
}

export function shortCommitSha(sha: string): string {
  return sha.slice(0, 7);
}

export function commitTitle(entry: QuestCommitEntry, details: QuestCommitLookup | undefined): string {
  return details?.message?.trim() || details?.shortSha || shortCommitSha(entry.sha);
}

export function commitCountLabel(count: number): string {
  return `${count} ${count === 1 ? "commit" : "commits"}`;
}

/**
 * "3 commits · 4 memory": code commits counted as every other commit count is (the diff chip in a
 * quest's pill card), with the memory repository's commits named apart.
 */
export function questCommitsLabel(entries: readonly Pick<QuestCommitEntry, "kind">[]): string {
  const memory = entries.filter((entry) => entry.kind === "memory").length;
  const code = entries.length - memory;
  if (!code) return `${memory} memory ${memory === 1 ? "commit" : "commits"}`;
  return memory ? `${commitCountLabel(code)} · ${memory} memory` : commitCountLabel(code);
}

export function sortedCommitEntries(
  entries: QuestCommitEntry[],
  lookupByKey: Record<string, QuestCommitLookup>,
): QuestCommitEntry[] {
  return [...entries].sort((a, b) => {
    const aTs = lookupByKey[commitLookupKey(a.kind, a.sha)]?.timestamp;
    const bTs = lookupByKey[commitLookupKey(b.kind, b.sha)]?.timestamp;
    if (typeof aTs === "number" && typeof bTs === "number" && aTs !== bTs) return aTs - bTs;
    return a.storedIndex - b.storedIndex;
  });
}

/**
 * A commits chip for the quest view's wrapping chip row. Its expanded list is a full-width flex
 * item ordered last, so it opens on its own line below the whole row instead of splitting it.
 */
export function QuestCommitEvidenceList({ entries, lookupByKey, onOpenCommit }: QuestCommitEvidenceListProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const listId = useId();
  if (entries.length === 0) return null;
  const countLabel = questCommitsLabel(entries);
  return (
    <>
      <QuestDisclosureChip
        expanded={isExpanded}
        controls={listId}
        onToggle={() => setIsExpanded((value) => !value)}
        ariaLabel={`${isExpanded ? "Collapse" : "Expand"} commits, ${countLabel}`}
      >
        {countLabel}
      </QuestDisclosureChip>
      {isExpanded && (
        <div id={listId} role="region" aria-label="Commits" className="order-last basis-full space-y-1">
          {entries.map((entry) => {
            const key = commitLookupKey(entry.kind, entry.sha);
            const details = lookupByKey[key];
            const label = commitTitle(entry, details);
            const kindLabel = entry.kind === "memory" ? "Memory" : "Code";
            return (
              <button
                key={key}
                type="button"
                onClick={() => onOpenCommit(entry)}
                className="flex w-full min-w-0 items-center gap-2 rounded-md border border-cc-border bg-cc-hover/60 px-2 py-1 text-left text-[11px] text-cc-fg transition-colors hover:border-cc-primary/30 hover:text-cc-primary"
                title={`${kindLabel} commit ${entry.sha}${details?.message ? `: ${details.message}` : ""}`}
                aria-label={`Open ${kindLabel.toLowerCase()} commit ${shortCommitSha(entry.sha)}`}
              >
                <span className="shrink-0 rounded border border-cc-border bg-cc-card px-1.5 py-0.5 text-[10px] text-cc-muted">
                  {kindLabel}
                </span>
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <span className="shrink-0 font-mono-code text-[10px] text-cc-muted">
                  {details?.shortSha || shortCommitSha(entry.sha)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
