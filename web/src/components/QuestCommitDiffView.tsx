import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type QuestCommitLookup } from "../api.js";
import { useStore } from "../store.js";
import type { QuestmasterTask } from "../types.js";
import { DiffViewer } from "./DiffViewer.js";
import { QuestCommitDiffHeader } from "./QuestCommitDiffHeader.js";
import "./QuestCommitDiffView.css";
import { commitLookupKey, sortedCommitEntries, type QuestCommitEntry } from "./QuestCommitEvidence.js";

const EMPTY_CODE_COMMIT_SHAS: string[] = [];
const BACKGROUND_COMMIT_METADATA_CONCURRENCY = 2;
const questCodeCommitDetailFetches = new Map<string, Promise<QuestmasterTask | null>>();

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

function findQuestById(quests: QuestmasterTask[], questId: string): QuestmasterTask | undefined {
  const normalizedQuestId = questId.toLowerCase();
  return quests.find((quest) => quest.questId.toLowerCase() === normalizedQuestId);
}

interface QuestCommitCandidate {
  commitShas: readonly string[];
  version: number;
  updatedAt: number;
  sourceRank: number;
}

function questCommitCandidate(
  quest: QuestmasterTask | null | undefined,
  sourceRank: number,
): QuestCommitCandidate | null {
  if (!Array.isArray(quest?.commitShas)) return null;
  return {
    commitShas: quest.commitShas,
    version: quest.version,
    updatedAt: Math.max(quest.createdAt, quest.updatedAt ?? 0, quest.statusChangedAt ?? 0),
    sourceRank,
  };
}

function shouldReplaceQuestCommitCandidate(
  current: QuestCommitCandidate | null,
  incoming: QuestCommitCandidate | null,
): incoming is QuestCommitCandidate {
  if (!incoming) return false;
  if (!current) return true;
  // Structured code evidence is append-only, so a shorter stale projection
  // cannot hide commits even when it arrives with misleading freshness.
  if (incoming.commitShas.length !== current.commitShas.length) {
    return incoming.commitShas.length > current.commitShas.length;
  }
  if (incoming.version !== current.version) return incoming.version > current.version;
  if (incoming.updatedAt !== current.updatedAt) return incoming.updatedAt > current.updatedAt;
  return incoming.sourceRank > current.sourceRank;
}

function getQuestCommitShasFromState(
  state: ReturnType<typeof useStore.getState> | null,
  questId: string | null | undefined,
): readonly string[] | null {
  if (!questId) return EMPTY_CODE_COMMIT_SHAS;
  const key = questId.toLowerCase();
  const candidates: Array<QuestCommitCandidate | null> = [
    questCommitCandidate(state?.quests ? findQuestById(state.quests, questId) : undefined, 1),
    questCommitCandidate(state?.questDetails?.get(key), 2),
  ];
  const preview = state?.questTitlePreviews?.get(key);
  if (preview && Array.isArray(preview.commitShas)) {
    candidates.push({
      commitShas: preview.commitShas,
      version: preview.version,
      updatedAt: preview.updatedAt ?? 0,
      sourceRank: 3,
    });
  }
  const selected = candidates.reduce<QuestCommitCandidate | null>(
    (current, candidate) => (shouldReplaceQuestCommitCandidate(current, candidate) ? candidate : current),
    null,
  );
  return selected ? selected.commitShas : null;
}

function fetchQuestCommitEvidence(questId: string): Promise<QuestmasterTask | null> {
  const key = questId.toLowerCase();
  const existing = questCodeCommitDetailFetches.get(key);
  if (existing) return existing;

  if (typeof api.getQuest !== "function") return Promise.resolve(null);

  const fetchPromise = api
    .getQuest(questId)
    .then((quest) => {
      if (typeof useStore.getState === "function") {
        useStore.getState().upsertQuestDetail(quest);
      }
      return quest;
    })
    .catch(() => null)
    .finally(() => {
      if (questCodeCommitDetailFetches.get(key) === fetchPromise) {
        questCodeCommitDetailFetches.delete(key);
      }
    });

  questCodeCommitDetailFetches.set(key, fetchPromise);
  return fetchPromise;
}

export function useQuestCodeCommitShas(
  questId: string | null | undefined,
  fallbackCommitShas?: readonly string[],
): {
  commitShas: readonly string[];
  loading: boolean;
} {
  const storeCommitShas = useStore((state) => getQuestCommitShasFromState(state, questId));
  const [resolvedMissingQuestId, setResolvedMissingQuestId] = useState<string | null>(null);

  useEffect(() => {
    setResolvedMissingQuestId(null);
  }, [questId]);

  useEffect(() => {
    if (!questId || storeCommitShas !== null || resolvedMissingQuestId === questId.toLowerCase()) return;
    let cancelled = false;
    void fetchQuestCommitEvidence(questId).then((quest) => {
      if (cancelled) return;
      if (!Array.isArray(quest?.commitShas)) setResolvedMissingQuestId(questId.toLowerCase());
    });
    return () => {
      cancelled = true;
    };
  }, [questId, resolvedMissingQuestId, storeCommitShas]);

  const loading =
    !!questId &&
    storeCommitShas === null &&
    fallbackCommitShas === undefined &&
    resolvedMissingQuestId !== questId.toLowerCase();
  return { commitShas: storeCommitShas ?? fallbackCommitShas ?? EMPTY_CODE_COMMIT_SHAS, loading };
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
  initialSha,
  lookup,
  preserveOrder = false,
}: {
  questId: string | null | undefined;
  storedEntries: QuestCommitEntry[];
  autoOpenFirst?: boolean;
  initialSha?: string;
  lookup?: (entry: QuestCommitEntry, includeDiff: boolean) => Promise<QuestCommitLookup>;
  preserveOrder?: boolean;
}): QuestCommitDiffState {
  const [activeCommitKey, setActiveCommitKey] = useState<string | null>(null);
  const [commitLookupByKey, setCommitLookupByKey] = useState<Record<string, QuestCommitLookup>>({});
  const [commitLookupLoadingKey, setCommitLookupLoadingKey] = useState<string | null>(null);
  const [commitLookupError, setCommitLookupError] = useState("");
  const lookupGenerationRef = useRef(0);
  const activeCommitKeyRef = useRef<string | null>(null);
  const metadataLookupInFlightKeysRef = useRef(new Set<string>());
  const fullDiffLookupInFlightKeysRef = useRef(new Set<string>());
  activeCommitKeyRef.current = activeCommitKey;

  useEffect(() => {
    lookupGenerationRef.current += 1;
    metadataLookupInFlightKeysRef.current.clear();
    fullDiffLookupInFlightKeysRef.current.clear();
    setActiveCommitKey(null);
    setCommitLookupByKey({});
    setCommitLookupLoadingKey(null);
    setCommitLookupError("");
  }, [questId]);

  const commitEntries = useMemo(
    () => (preserveOrder ? storedEntries : sortedCommitEntries(storedEntries, commitLookupByKey)),
    [storedEntries, commitLookupByKey, preserveOrder],
  );

  useEffect(() => {
    const validKeys = new Set(storedEntries.map((entry) => commitLookupKey(entry.kind, entry.sha)));
    setActiveCommitKey((current) => {
      if (current && validKeys.has(current)) return current;
      if (!autoOpenFirst && !initialSha) return null;
      const first = initialSha ? storedEntries.find((entry) => entry.sha === initialSha) : storedEntries[0];
      return first ? commitLookupKey(first.kind, first.sha) : null;
    });
  }, [autoOpenFirst, initialSha, storedEntries]);

  const openCommit = useCallback((entry: QuestCommitEntry) => {
    setActiveCommitKey(commitLookupKey(entry.kind, entry.sha));
    setCommitLookupError("");
  }, []);

  const closeCommit = useCallback(() => {
    setActiveCommitKey(null);
    setCommitLookupError("");
  }, []);

  const activeCommitIndex = activeCommitKey
    ? commitEntries.findIndex((entry) => commitLookupKey(entry.kind, entry.sha) === activeCommitKey)
    : -1;
  const activeCommitEntry = activeCommitIndex >= 0 ? commitEntries[activeCommitIndex] : null;
  const activeCommitDetails = activeCommitKey ? commitLookupByKey[activeCommitKey] : undefined;

  useEffect(() => {
    if (!questId || !activeCommitKey) return;
    const requestCommitKey = activeCommitKey;
    const activeEntry = commitEntries.find((entry) => commitLookupKey(entry.kind, entry.sha) === activeCommitKey);
    if (!activeEntry) return;
    const cached = commitLookupByKey[activeCommitKey];
    if (cached && (!cached.available || typeof cached.diff === "string")) return;
    if (fullDiffLookupInFlightKeysRef.current.has(activeCommitKey)) return;

    const lookupGeneration = lookupGenerationRef.current;
    fullDiffLookupInFlightKeysRef.current.add(activeCommitKey);
    setCommitLookupLoadingKey(activeCommitKey);
    setCommitLookupError("");
    const request = lookup
      ? lookup(activeEntry, true)
      : activeEntry.kind === "memory"
        ? api.getQuestMemoryCommit(questId, activeEntry.sha)
        : api.getQuestCommit(questId, activeEntry.sha);
    const isCurrentRequest = () =>
      lookupGeneration === lookupGenerationRef.current && activeCommitKeyRef.current === requestCommitKey;
    request
      .then((details) => {
        if (!isCurrentRequest()) return;
        setCommitLookupByKey((prev) => ({ ...prev, [requestCommitKey]: details }));
      })
      .catch((e) => {
        if (!isCurrentRequest()) return;
        setCommitLookupError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (lookupGeneration !== lookupGenerationRef.current) return;
        fullDiffLookupInFlightKeysRef.current.delete(requestCommitKey);
        if (!isCurrentRequest()) return;
        setCommitLookupLoadingKey((prev) => (prev === requestCommitKey ? null : prev));
      });
  }, [questId, activeCommitKey, commitEntries, commitLookupByKey, lookup]);

  useEffect(() => {
    if (!questId || storedEntries.length === 0) return;
    if (autoOpenFirst && !activeCommitKey) return;
    const availableSlots = BACKGROUND_COMMIT_METADATA_CONCURRENCY - metadataLookupInFlightKeysRef.current.size;
    if (availableSlots <= 0) return;

    const metadataEntries = storedEntries
      .filter((entry) => {
        const key = commitLookupKey(entry.kind, entry.sha);
        if (key === activeCommitKey) return false;
        if (commitLookupByKey[key]) return false;
        if (metadataLookupInFlightKeysRef.current.has(key)) return false;
        if (fullDiffLookupInFlightKeysRef.current.has(key)) return false;
        return true;
      })
      .slice(0, availableSlots);
    if (metadataEntries.length === 0) return;

    const lookupGeneration = lookupGenerationRef.current;
    for (const entry of metadataEntries) {
      const key = commitLookupKey(entry.kind, entry.sha);
      metadataLookupInFlightKeysRef.current.add(key);
      const request = lookup
        ? lookup(entry, false)
        : entry.kind === "memory"
          ? api.getQuestMemoryCommit(questId, entry.sha, { includeDiff: false })
          : api.getQuestCommit(questId, entry.sha, { includeDiff: false });
      request
        .then((details) => {
          if (lookupGeneration !== lookupGenerationRef.current) return;
          metadataLookupInFlightKeysRef.current.delete(key);
          setCommitLookupByKey((prev) => (prev[key] ? prev : { ...prev, [key]: details }));
        })
        .catch(() => {
          if (lookupGeneration !== lookupGenerationRef.current) return;
          metadataLookupInFlightKeysRef.current.delete(key);
          setCommitLookupByKey((prev) =>
            prev[key] ? prev : { ...prev, [key]: { sha: entry.sha, available: false, reason: "commit_not_available" } },
          );
        });
    }
  }, [questId, autoOpenFirst, activeCommitKey, storedEntries, commitLookupByKey, lookup]);

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
  commitLabel,
  headerContext,
  children,
  emptyTitle = "No recorded commits yet",
  emptyMessage = "This quest does not have any recorded code commits yet.",
}: {
  state: QuestCommitDiffState;
  onClose?: () => void;
  commitLabel?: string;
  /** Host-specific delivery/review controls share the compact context row. */
  headerContext?: ReactNode;
  /** A host may show review-list loading/errors without removing the shared header. */
  children?: ReactNode;
  emptyTitle?: string;
  emptyMessage?: string;
}) {
  const [fileNavigationTarget, setFileNavigationTarget] = useState<HTMLSpanElement | null>(null);
  const {
    commitEntries,
    activeCommitEntry,
    activeCommitKey,
    activeCommitDetails,
    commitLookupLoadingKey,
    commitLookupError,
  } = state;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="quest-commit-diff-view">
      <QuestCommitDiffHeader
        state={state}
        onClose={onClose}
        commitLabel={commitLabel}
        context={headerContext}
        fileNavigationRef={setFileNavigationTarget}
      />
      <div className="quest-commit-diff-scroll min-h-0 flex-1 overflow-auto bg-cc-bg/40">
        {children ??
          (commitEntries.length === 0 ? (
            <div
              className="flex h-full min-h-48 flex-col items-center justify-center gap-2 px-6 text-center"
              data-testid="quest-commit-empty-state"
            >
              <div className="text-sm font-medium text-cc-fg">{emptyTitle}</div>
              <div className="max-w-md text-sm text-cc-muted">{emptyMessage}</div>
            </div>
          ) : !activeCommitEntry ? (
            <div className="flex h-full min-h-48 items-center justify-center px-6 text-center text-sm text-cc-muted">
              Select a recorded commit to inspect.
            </div>
          ) : commitLookupLoadingKey === activeCommitKey &&
            (!activeCommitDetails ||
              (activeCommitDetails.available && typeof activeCommitDetails.diff !== "string")) ? (
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
            <div className="quest-commit-diff-content flex flex-col gap-3">
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
                fileNavigationTarget={fileNavigationTarget}
              />
            </div>
          ) : (
            <div className="h-full min-h-48 flex items-center justify-center text-sm text-cc-muted">
              Loading commit metadata...
            </div>
          ))}
      </div>
    </div>
  );
}

export function QuestCodeCommitDiffPanel({ questId }: { questId: string }) {
  const { commitShas, loading } = useQuestCodeCommitShas(questId);
  const storedEntries = useMemo(() => buildCodeCommitEntries(commitShas), [commitShas]);
  const state = useQuestCommitDiffState({ questId, storedEntries, autoOpenFirst: true });
  if (loading) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center px-6 text-center text-sm text-cc-muted">
        Loading recorded commits...
      </div>
    );
  }
  return (
    <QuestCommitDiffView
      state={state}
      emptyTitle="No recorded commits yet"
      emptyMessage={`${questId} does not have any recorded code commits yet.`}
    />
  );
}
