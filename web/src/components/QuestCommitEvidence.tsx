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

export function QuestCommitEvidenceList({ entries, lookupByKey, onOpenCommit }: QuestCommitEvidenceListProps) {
  if (entries.length === 0) return null;
  return (
    <div className="mt-2 max-w-full space-y-1.5">
      <span className="text-[10px] uppercase tracking-[0.08em] text-cc-muted/60">Commit evidence</span>
      <div className="space-y-1">
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
    </div>
  );
}
