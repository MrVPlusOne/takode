import { useEffect, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import type { DiffTargetResolution } from "../utils/diff-target.js";
import {
  formatDiffLineCount,
  hasSessionDiff,
  resolveSessionDiffSummary,
  type SessionDiffSummary,
} from "../utils/session-diff-summary.js";
import { DiffPanel } from "./DiffPanel.js";
import { QuestCodeCommitDiffPanel, useQuestCodeCommitShas } from "./QuestCommitDiffView.js";
import { commitCountLabel } from "./QuestCommitEvidence.js";

type QuestDiffSection = "commits" | "changes";

/**
 * The diff view a diff chip opens. Quest targets show the recorded commits and, when the quest has a
 * worker, a second section with that worker's changes; session targets show the session's own changes.
 * The back button replaces the old top-bar Diff toggle as the way back to the conversation.
 */
export function DiffTabView({ target, onBack }: { target: DiffTargetResolution; onBack: () => void }) {
  if (target.kind === "session") {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="diff-tab-view" data-target-kind="session">
        <DiffViewNav onBack={onBack}>
          <span className="min-w-0 truncate text-[12px] font-medium text-cc-fg" data-testid="diff-tab-title">
            {target.source === "leader" ? "Leader changes" : "Session changes"}
          </span>
        </DiffViewNav>
        <div className="min-h-0 flex-1">
          <DiffPanel sessionId={target.sessionId} />
        </div>
      </div>
    );
  }
  return <QuestDiffView key={target.questId} target={target} onBack={onBack} />;
}

function QuestDiffView({
  target,
  onBack,
}: {
  target: Extract<DiffTargetResolution, { kind: "quest" }>;
  onBack: () => void;
}) {
  const { commitShas } = useQuestCodeCommitShas(target.questId);
  const changes = useStore(useShallow((state) => resolveSessionDiffSummary(state, target.workerSessionId)));
  const workerNote = useStore((state) => workerAvailabilityNote(state, target.workerSessionId));
  const [chosenSection, setChosenSection] = useState<QuestDiffSection | null>(null);
  useEffect(() => setChosenSection(null), [target.workerSessionId]);
  const workerSessionId = target.workerSessionId;
  // Until the user picks one, open whichever section has something to show, commits first.
  const section: QuestDiffSection = !workerSessionId
    ? "commits"
    : (chosenSection ?? (commitShas.length === 0 && hasSessionDiff(changes) ? "changes" : "commits"));
  // Phones drop "Worker" so both sections fit beside the back button.
  const changesName =
    target.changesOwner === "self" ? (
      "Changes"
    ) : (
      <>
        <span className="sm:hidden">Changes</span>
        <span className="hidden sm:inline">Worker changes</span>
      </>
    );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="diff-tab-view" data-target-kind="quest">
      <DiffViewNav onBack={onBack}>
        <span className="shrink-0 font-mono-code text-[12px] font-medium text-cc-fg" data-testid="diff-tab-title">
          {target.questId}
        </span>
        {workerSessionId && (
          <div
            role="tablist"
            aria-label={`${target.questId} diff sections`}
            className="flex min-w-0 items-center gap-0.5 rounded-md border border-cc-border p-0.5"
          >
            <SectionTab
              selected={section === "commits"}
              onSelect={() => setChosenSection("commits")}
              testId="diff-tab-commits"
            >
              {commitShas.length > 0 ? commitCountLabel(commitShas.length) : "No commits"}
            </SectionTab>
            <SectionTab
              selected={section === "changes"}
              onSelect={() => setChosenSection("changes")}
              testId="diff-tab-changes"
            >
              <span>{changesName}</span>
              <ChangeCounts changes={changes} />
            </SectionTab>
          </div>
        )}
        {section === "changes" && workerNote && (
          <span className="min-w-0 truncate text-[11px] text-cc-warning" data-testid="diff-tab-worker-note">
            {workerNote}
          </span>
        )}
      </DiffViewNav>
      <div className="min-h-0 flex-1">
        {section === "changes" && workerSessionId ? (
          <DiffPanel sessionId={workerSessionId} />
        ) : (
          <QuestCodeCommitDiffPanel questId={target.questId} />
        )}
      </div>
    </div>
  );
}

function DiffViewNav({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <div
      className="flex min-w-0 shrink-0 items-center gap-2 border-b border-cc-border bg-cc-card px-2 py-1 sm:px-3"
      data-testid="diff-tab-nav"
    >
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:outline focus-visible:outline-cc-primary"
        aria-label="Back to chat"
        title="Back to chat"
        data-testid="diff-tab-back"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3.5 w-3.5">
          <path d="M10 3 5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Chat</span>
      </button>
      {children}
    </div>
  );
}

function SectionTab({
  selected,
  onSelect,
  testId,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      data-testid={testId}
      className={`inline-flex h-6 min-w-0 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[11px] transition-colors ${
        selected ? "bg-cc-active font-medium text-cc-fg" : "text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
      }`}
    >
      {children}
    </button>
  );
}

function ChangeCounts({ changes }: { changes: SessionDiffSummary }) {
  if (changes.linesAdded > 0 || changes.linesRemoved > 0) {
    return (
      <span className="inline-flex items-center gap-1 font-mono-code tabular-nums">
        <span className="text-green-500">+{formatDiffLineCount(changes.linesAdded)}</span>
        <span className="text-red-400">-{formatDiffLineCount(changes.linesRemoved)}</span>
      </span>
    );
  }
  if (changes.changedFiles > 0) {
    return <span className="tabular-nums">{changes.changedFiles}</span>;
  }
  return <span className="text-cc-muted">none</span>;
}

/** The worker's diff is still readable from its checkout, but say when the worker itself is gone. */
function workerAvailabilityNote(
  state: ReturnType<typeof useStore.getState>,
  workerSessionId: string | null,
): string | null {
  if (!workerSessionId) return null;
  const worker = state.sdkSessions.find((session) => session.sessionId === workerSessionId);
  if (!worker) return "Worker session not found";
  return worker.archived ? "Worker is archived" : null;
}
