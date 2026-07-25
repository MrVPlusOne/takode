import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type QuestCommitLookup } from "../api.js";
import type { QuestmasterTask } from "../types.js";
import { DiffViewer } from "./DiffViewer.js";
import {
  commitLookupKey,
  commitTitle,
  shortCommitSha,
  sortedCommitEntries,
  type QuestCommitEntry,
} from "./QuestCommitEvidence.js";

export function buildCodeCommitEntries(commitShas: readonly string[] | undefined): QuestCommitEntry[] {
  return (commitShas ?? []).map((sha, storedIndex) => ({
    kind: "code" as const,
    sha,
    storedIndex,
  }));
}

export function buildQuestCommitEntries(
  quest: Pick<QuestmasterTask, "commitShas" | "memoryCommitShas"> | null | undefined,
): QuestCommitEntry[] {
  if (!quest) return [];
  const codeEntries = buildCodeCommitEntries(quest.commitShas);
  const memoryOffset = codeEntries.length;
  const memoryEntries = (quest.memoryCommitShas ?? []).map((sha, index) => ({
    kind: "memory" as const,
    sha,
    storedIndex: memoryOffset + index,
  }));
  return [...codeEntries, ...memoryEntries];
}

export interface QuestCommitDiffState {
  commitEntries: QuestCommitEntry[];
  commitLookupByKey: Record<string, QuestCommitLookup>;
  commitLookupLoadingKey: string | null;
  commitLookupError: string;
  activeCommitKey: string | null;
  activeCommitIndex: number;
  activeCommitEntry: QuestCommitEntry | null;
  activeCommitDetails: QuestCommitLookup | undefined;
  openCommit: (entry: QuestCommitEntry) => void;
  closeCommit: () => void;
  setActiveCommitKey: (key: string | null) => void;
}

export function useQuestCommitDiffState({
  questId,
  storedEntries,
  autoOpenFirst = false,
}: {
  questId: string | null | undefined;
  storedEntries: QuestCommitEntry[];
  autoOpenFirst?: boolean;
}): QuestCommitDiffState {
  const [activeCommitKey, setActiveCommitKey] = useState<string | null>(null);
  const [commitLookupByKey, setCommitLookupByKey] = useState<Record<string, QuestCommitLookup>>({});
  const [commitLookupLoadingKey, setCommitLookupLoadingKey] = useState<string | null>(null);
  const [commitLookupError, setCommitLookupError] = useState("");

  useEffect(() => {
    setActiveCommitKey(null);
    setCommitLookupByKey({});
    setCommitLookupLoadingKey(null);
    setCommitLookupError("");
  }, [questId]);

  const commitEntries = useMemo(
    () => sortedCommitEntries(storedEntries, commitLookupByKey),
    [storedEntries, commitLookupByKey],
  );

  useEffect(() => {
    const validKeys = new Set(storedEntries.map((entry) => commitLookupKey(entry.kind, entry.sha)));
    setActiveCommitKey((current) => {
      if (current && validKeys.has(current)) return current;
      if (!autoOpenFirst) return null;
      const first = storedEntries[0];
      return first ? commitLookupKey(first.kind, first.sha) : null;
    });
  }, [autoOpenFirst, storedEntries]);

  const openCommit = useCallback((entry: QuestCommitEntry) => {
    setActiveCommitKey(commitLookupKey(entry.kind, entry.sha));
    setCommitLookupError("");
  }, []);

  const closeCommit = useCallback(() => {
    setActiveCommitKey(null);
    setCommitLookupError("");
  }, []);

  useEffect(() => {
    if (!questId || storedEntries.length === 0) return;
    let cancelled = false;
    for (const entry of storedEntries) {
      const key = commitLookupKey(entry.kind, entry.sha);
      if (commitLookupByKey[key]) continue;
      const lookup =
        entry.kind === "memory"
          ? api.getQuestMemoryCommit(questId, entry.sha, { includeDiff: false })
          : api.getQuestCommit(questId, entry.sha, { includeDiff: false });
      lookup
        .then((details) => {
          if (cancelled) return;
          setCommitLookupByKey((prev) => (prev[key] ? prev : { ...prev, [key]: details }));
        })
        .catch(() => {
          if (cancelled) return;
          setCommitLookupByKey((prev) =>
            prev[key] ? prev : { ...prev, [key]: { sha: entry.sha, available: false, reason: "commit_not_available" } },
          );
        });
    }
    return () => {
      cancelled = true;
    };
  }, [questId, storedEntries, commitLookupByKey]);

  const activeCommitIndex = activeCommitKey
    ? commitEntries.findIndex((entry) => commitLookupKey(entry.kind, entry.sha) === activeCommitKey)
    : -1;
  const activeCommitEntry = activeCommitIndex >= 0 ? commitEntries[activeCommitIndex] : null;
  const activeCommitDetails = activeCommitKey ? commitLookupByKey[activeCommitKey] : undefined;

  useEffect(() => {
    if (!questId || !activeCommitKey) return;
    const activeEntry = commitEntries.find((entry) => commitLookupKey(entry.kind, entry.sha) === activeCommitKey);
    if (!activeEntry) return;
    const cached = commitLookupByKey[activeCommitKey];
    if (cached && (!cached.available || cached.diff)) return;

    let cancelled = false;
    setCommitLookupLoadingKey(activeCommitKey);
    setCommitLookupError("");
    const lookup =
      activeEntry.kind === "memory"
        ? api.getQuestMemoryCommit(questId, activeEntry.sha)
        : api.getQuestCommit(questId, activeEntry.sha);
    lookup
      .then((details) => {
        if (cancelled) return;
        setCommitLookupByKey((prev) => ({ ...prev, [activeCommitKey]: details }));
      })
      .catch((e) => {
        if (cancelled) return;
        setCommitLookupError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (cancelled) return;
        setCommitLookupLoadingKey((prev) => (prev === activeCommitKey ? null : prev));
      });

    return () => {
      cancelled = true;
    };
  }, [questId, activeCommitKey, commitEntries, commitLookupByKey]);

  return {
    commitEntries,
    commitLookupByKey,
    commitLookupLoadingKey,
    commitLookupError,
    activeCommitKey,
    activeCommitIndex,
    activeCommitEntry,
    activeCommitDetails,
    openCommit,
    closeCommit,
    setActiveCommitKey,
  };
}

export function QuestCommitDiffView({
  state,
  onClose,
  emptyTitle = "No recorded commits yet",
  emptyMessage = "This quest does not have any recorded code commits yet.",
}: {
  state: QuestCommitDiffState;
  onClose?: () => void;
  emptyTitle?: string;
  emptyMessage?: string;
}) {
  const {
    commitEntries,
    commitLookupByKey,
    commitLookupLoadingKey,
    commitLookupError,
    activeCommitKey,
    activeCommitIndex,
    activeCommitEntry,
    activeCommitDetails,
    setActiveCommitKey,
  } = state;

  if (commitEntries.length === 0) {
    return (
      <div
        className="flex h-full min-h-48 flex-col items-center justify-center gap-2 px-6 text-center"
        data-testid="quest-commit-empty-state"
      >
        <div className="text-sm font-medium text-cc-fg">{emptyTitle}</div>
        <div className="max-w-md text-sm text-cc-muted">{emptyMessage}</div>
      </div>
    );
  }

  if (!activeCommitEntry) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center px-6 text-center text-sm text-cc-muted">
        Select a recorded commit to inspect.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="quest-commit-diff-view">
      <div className="flex shrink-0 items-start justify-between gap-3 px-3 py-2 border-b border-cc-border">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[10px] uppercase tracking-[0.08em] text-cc-muted/60">
              {activeCommitEntry.kind === "memory" ? "Memory Commit" : "Code Commit"}
            </span>
            <span className="text-sm font-semibold text-cc-fg">
              {commitTitle(activeCommitEntry, activeCommitDetails)}
            </span>
            <span className="font-mono-code text-[10px] text-cc-muted">
              {activeCommitDetails?.shortSha || shortCommitSha(activeCommitEntry.sha)}
            </span>
            <span className="text-[10px] text-cc-muted">{`${activeCommitIndex + 1}/${commitEntries.length}`}</span>
            {activeCommitDetails?.timestamp ? (
              <span className="text-[10px] text-cc-muted">{timeAgo(activeCommitDetails.timestamp)}</span>
            ) : null}
            {activeCommitDetails?.available &&
              typeof activeCommitDetails.additions === "number" &&
              typeof activeCommitDetails.deletions === "number" && (
                <span className="flex items-center gap-3 text-[11px]">
                  <span className="text-green-500">+{activeCommitDetails.additions ?? 0} additions</span>
                  <span className="text-red-400">-{activeCommitDetails.deletions ?? 0} deletions</span>
                </span>
              )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {commitEntries.map((entry) => {
              const key = commitLookupKey(entry.kind, entry.sha);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => state.openCommit(entry)}
                  className={`max-w-[12rem] truncate rounded-full border px-2 py-0.5 text-[10px] transition-colors cursor-pointer ${
                    key === activeCommitKey
                      ? "bg-cc-primary/15 text-cc-primary border-cc-primary/30"
                      : "bg-cc-hover text-cc-fg border-cc-border hover:border-cc-primary/30 hover:text-cc-primary"
                  }`}
                  title={entry.sha}
                >
                  {entry.kind === "memory" ? "Memory" : "Code"} {shortCommitSha(entry.sha)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              const previous = activeCommitIndex > 0 ? commitEntries[activeCommitIndex - 1] : null;
              if (previous) setActiveCommitKey(commitLookupKey(previous.kind, previous.sha));
            }}
            disabled={activeCommitIndex <= 0}
            className="px-2 py-1 text-[11px] rounded-lg bg-cc-hover text-cc-fg border border-cc-border disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => {
              const next = activeCommitIndex < commitEntries.length - 1 ? commitEntries[activeCommitIndex + 1] : null;
              if (next) setActiveCommitKey(commitLookupKey(next.kind, next.sha));
            }}
            disabled={activeCommitIndex >= commitEntries.length - 1}
            className="px-2 py-1 text-[11px] rounded-lg bg-cc-hover text-cc-fg border border-cc-border disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            Next
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-cc-hover text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
              aria-label="Close commit modal"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="quest-commit-diff-scroll min-h-0 flex-1 overflow-auto bg-cc-bg/40 px-4 pb-4 pt-0">
        {commitLookupLoadingKey === activeCommitKey &&
        (!activeCommitDetails || (activeCommitDetails.available && !activeCommitDetails.diff)) ? (
          <div className="h-full min-h-48 flex items-center justify-center text-sm text-cc-muted">
            Loading commit diff...
          </div>
        ) : commitLookupError ? (
          <div className="h-full min-h-48 flex items-center justify-center text-sm text-red-400">
            {commitLookupError}
          </div>
        ) : activeCommitDetails && !activeCommitDetails.available ? (
          <div className="h-full min-h-48 flex flex-col items-center justify-center gap-2 text-center px-6">
            <div className="text-sm font-medium text-cc-fg">Commit not available</div>
            <div className="text-sm text-cc-muted max-w-md">
              {activeCommitDetails.reason === "repo_unavailable"
                ? activeCommitEntry.kind === "memory"
                  ? "The configured local memory repo is not available."
                  : "The quest no longer has an available session checkout to read this commit from."
                : "This commit is no longer available in local git history."}
            </div>
          </div>
        ) : activeCommitDetails ? (
          <div
            className={`quest-commit-diff-content flex flex-col gap-3 ${activeCommitDetails.truncated ? "pt-4" : ""}`}
          >
            {activeCommitDetails.truncated && (
              <div className="px-3 py-2 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-300">
                Commit diff truncated for display.
              </div>
            )}
            <DiffViewer
              unifiedDiff={activeCommitDetails.diff}
              sourceFiles={activeCommitDetails.sourceFiles?.map((sourceFile) => ({
                fileName: sourceFile.path,
                ...(sourceFile.previousPath ? { previousFileName: sourceFile.previousPath } : {}),
                oldText: sourceFile.oldText,
                newText: sourceFile.newText,
              }))}
              fileName={activeCommitDetails.shortSha}
              mode="full"
              showLineNumbers
              stickyFileHeaders
              collapsibleFiles
            />
          </div>
        ) : (
          <div className="h-full min-h-48 flex items-center justify-center text-sm text-cc-muted">
            Loading commit metadata...
          </div>
        )}
      </div>
    </div>
  );
}

export function QuestCodeCommitDiffPanel({ questId, commitShas }: { questId: string; commitShas: readonly string[] }) {
  const storedEntries = useMemo(() => buildCodeCommitEntries(commitShas), [commitShas]);
  const state = useQuestCommitDiffState({ questId, storedEntries, autoOpenFirst: true });
  return (
    <QuestCommitDiffView
      state={state}
      emptyTitle="No recorded commits yet"
      emptyMessage={`${questId} does not have any recorded code commits yet.`}
    />
  );
}

function timeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - timestamp);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
