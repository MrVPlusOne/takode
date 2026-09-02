import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { QuestOutcomeRevision, QuestOutcomeState, QuestQuizItem } from "../types.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { QuestQuizSection } from "./QuestQuizSection.js";

function currentRevision(outcome: QuestOutcomeState): QuestOutcomeRevision | null {
  return outcome.revisions.find((revision) => revision.revisionId === outcome.currentRevisionId) ?? null;
}

function revisionLabel(index: number): string {
  return `Version ${index + 1}`;
}

function editorLabel(status: string, reopened: boolean): string {
  if (reopened) return "Previous Outcome";
  return status === "done" ? "Outcome" : "Current Outcome";
}

export function QuestOutcomeCard({
  questId,
  questTitle,
  questStatus,
  outcome,
  sessionId,
  newerActivityBelow,
  showQuiz,
  quizItems,
}: {
  questId: string;
  questTitle: string;
  questStatus: string;
  outcome: QuestOutcomeState;
  sessionId: string;
  newerActivityBelow: boolean;
  showQuiz: boolean;
  quizItems?: QuestQuizItem[];
}) {
  const revision = currentRevision(outcome);
  const revisionIndex = revision
    ? outcome.revisions.findIndex((candidate) => candidate.revisionId === revision.revisionId)
    : -1;
  const previousRevisions = useMemo(
    () => outcome.revisions.filter((candidate) => candidate.revisionId !== outcome.currentRevisionId).reverse(),
    [outcome.currentRevisionId, outcome.revisions],
  );
  const [editing, setEditing] = useState(false);
  const [markdown, setMarkdown] = useState(revision?.markdown ?? "");
  const [summaryMarkdown, setSummaryMarkdown] = useState(
    revision?.summarySource === "authored" ? revision.summaryMarkdown : "",
  );
  const [draftBaseRevisionId, setDraftBaseRevisionId] = useState(revision?.revisionId ?? "");
  const [draftDirty, setDraftDirty] = useState(false);
  const [newerRevisionAvailable, setNewerRevisionAvailable] = useState(false);
  const [advanceThroughLatest, setAdvanceThroughLatest] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [observedRevisionId, setObservedRevisionId] = useState(revision?.revisionId ?? "");

  const loadRevision = () => {
    if (!revision) return;
    setMarkdown(revision.markdown);
    setSummaryMarkdown(revision.summarySource === "authored" ? revision.summaryMarkdown : "");
    setDraftBaseRevisionId(revision.revisionId);
    setAdvanceThroughLatest(false);
    setDraftDirty(false);
    setNewerRevisionAvailable(false);
    setError("");
  };

  useEffect(() => {
    if (!revision || revision.revisionId === observedRevisionId) return;
    setObservedRevisionId(revision.revisionId);
    if (editing && draftDirty) {
      setNewerRevisionAvailable(true);
      return;
    }
    setMarkdown(revision.markdown);
    setSummaryMarkdown(revision.summarySource === "authored" ? revision.summaryMarkdown : "");
    setDraftBaseRevisionId(revision.revisionId);
    setAdvanceThroughLatest(false);
    setDraftDirty(false);
    setNewerRevisionAvailable(false);
    setError("");
  }, [draftDirty, editing, observedRevisionId, revision]);

  if (!revision) return null;
  const reopened = questStatus !== "done" && outcome.reopenedAt !== undefined;
  const label = editorLabel(questStatus, reopened);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await api.updateQuestOutcome(questId, {
        baseRevisionId: draftBaseRevisionId,
        markdown,
        ...(summaryMarkdown.trim() ? { summaryMarkdown } : {}),
        ...(advanceThroughLatest ? { advanceThroughSessionId: sessionId } : {}),
        idempotencyKey: `edit:${revision.revisionId}:${Date.now()}`,
      });
      useStore.getState().upsertQuestDetail(result.quest);
      setEditing(false);
      setDraftDirty(false);
      setNewerRevisionAvailable(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update the Outcome.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="min-w-0 rounded-xl border border-cc-primary/30 bg-cc-card shadow-sm"
      aria-label={`${label} for ${questId}`}
      data-testid="quest-outcome-card"
      data-feed-block-id={`quest-outcome:${questId}`}
    >
      <div className="flex min-w-0 flex-wrap items-start gap-2 border-b border-cc-border/70 px-3 py-2.5 sm:px-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-sm font-semibold text-cc-fg">{label}</h2>
            <span className="rounded-full border border-cc-border/70 bg-cc-hover/40 px-1.5 py-0.5 font-mono-code text-[10px] text-cc-muted">
              {revisionLabel(revisionIndex)}
            </span>
            {newerActivityBelow && (
              <span className="text-[10px] font-medium text-cc-attention" data-testid="quest-outcome-newer-activity">
                Newer activity follows
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-cc-muted/70">
            {questTitle} · updated {new Date(revision.createdAt).toLocaleString()}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (editing) {
              setEditing(false);
              return;
            }
            loadRevision();
            setEditing(true);
          }}
          className="shrink-0 rounded-md border border-cc-border bg-cc-hover/35 px-2.5 py-1 text-xs font-medium text-cc-fg transition-colors hover:border-cc-primary/40 hover:bg-cc-hover"
          aria-expanded={editing}
        >
          {editing ? "Close editor" : "Edit"}
        </button>
      </div>

      {editing ? (
        <div className="space-y-3 px-3 py-3 sm:px-4" data-testid="quest-outcome-editor">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-cc-fg">Outcome Markdown</span>
            <textarea
              value={markdown}
              onChange={(event) => {
                setMarkdown(event.target.value);
                setDraftDirty(true);
              }}
              rows={10}
              className="min-h-44 w-full resize-y rounded-lg border border-cc-border bg-cc-input-bg px-3 py-2 font-mono-code text-xs leading-relaxed text-cc-fg outline-none focus:border-cc-primary/60 focus:ring-2 focus:ring-cc-primary/20"
            />
          </label>
          <details className="rounded-lg border border-cc-border/70 bg-cc-input-bg/40">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-cc-muted hover:text-cc-fg">
              Custom compact summary (optional)
            </summary>
            <label className="block space-y-1.5 border-t border-cc-border/60 px-3 py-2">
              <span className="text-[11px] text-cc-muted">
                Leave blank to derive the preview from complete opening Markdown blocks.
              </span>
              <textarea
                value={summaryMarkdown}
                onChange={(event) => {
                  setSummaryMarkdown(event.target.value);
                  setDraftDirty(true);
                }}
                rows={4}
                className="w-full resize-y rounded-md border border-cc-border bg-cc-input-bg px-2.5 py-2 text-xs text-cc-fg outline-none focus:border-cc-primary/60"
              />
            </label>
          </details>
          {questStatus === "done" && (
            <div className="rounded-md border border-cc-border/70 bg-cc-hover/25 px-3 py-2 text-xs text-cc-muted">
              Completed-quest edits should clarify wording or incorporate later discussion. Reopen the quest before
              changing delivered scope or claims.
            </div>
          )}
          <label className="flex min-w-0 items-start gap-2 text-xs text-cc-muted">
            <input
              type="checkbox"
              checked={advanceThroughLatest}
              onChange={(event) => {
                setAdvanceThroughLatest(event.target.checked);
                setDraftDirty(true);
              }}
              className="mt-0.5"
            />
            <span>
              {questStatus === "done"
                ? "Move this card after the latest clarification activity. Leave unchecked for wording-only edits."
                : "Move this card after the latest activity in this quest thread. Leave unchecked for wording-only edits."}
            </span>
          </label>
          {newerRevisionAvailable && (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-cc-attention/35 bg-cc-attention/10 px-3 py-2 text-xs text-cc-fg"
            >
              <span>A newer Outcome version is available. Your draft is preserved against its original base.</span>
              <button
                type="button"
                onClick={loadRevision}
                className="rounded-md border border-cc-attention/40 px-2 py-1 font-medium text-cc-attention hover:bg-cc-attention/10"
              >
                Load latest version
              </button>
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="rounded-md border border-cc-error/30 bg-cc-error/10 px-3 py-2 text-xs text-cc-error"
            >
              {error}
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                loadRevision();
                setEditing(false);
              }}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !markdown.trim()}
              className="rounded-md bg-cc-primary px-3 py-1.5 text-xs font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save new version"}
            </button>
          </div>
        </div>
      ) : (
        <div className="px-3 py-3 sm:px-4">
          <MarkdownContent
            text={revision.markdown}
            sessionId={sessionId}
            questLinkSurface="chat-feed"
            wrapLongContent
          />
        </div>
      )}

      {previousRevisions.length > 0 && (
        <details
          className="border-t border-cc-border/70"
          data-testid="quest-outcome-versions"
          onToggle={(event) => setVersionsOpen(event.currentTarget.open)}
        >
          <summary
            className="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-cc-muted hover:bg-cc-hover/30 hover:text-cc-fg sm:px-4"
            onClick={(event) => setVersionsOpen(!(event.currentTarget.parentElement as HTMLDetailsElement).open)}
          >
            <span>Versions</span>
            <span className="font-mono-code text-[10px]">{previousRevisions.length}</span>
          </summary>
          {versionsOpen && (
            <div className="space-y-2 border-t border-cc-border/60 px-3 py-3 sm:px-4">
              {previousRevisions.map((previous) => {
                const index = outcome.revisions.findIndex((candidate) => candidate.revisionId === previous.revisionId);
                return (
                  <details
                    key={previous.revisionId}
                    className="rounded-lg border border-cc-border/70 bg-cc-input-bg/35"
                  >
                    <summary className="cursor-pointer select-none px-3 py-2 text-xs text-cc-muted hover:text-cc-fg">
                      {revisionLabel(index)} · {new Date(previous.createdAt).toLocaleString()}
                    </summary>
                    <div className="border-t border-cc-border/60 px-3 py-2.5">
                      <MarkdownContent
                        text={previous.markdown}
                        size="sm"
                        variant="conservative"
                        sessionId={sessionId}
                        questLinkSurface="chat-feed"
                        wrapLongContent
                      />
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </details>
      )}

      {showQuiz && (quizItems?.length ?? 0) > 0 && (
        <div className="border-t border-cc-border/70 px-3 pb-3 sm:px-4">
          <QuestQuizSection
            items={quizItems}
            questId={questId}
            questTitle={questTitle}
            variant="inline"
            sessionId={sessionId}
            questLinkSurface="chat-feed"
          />
        </div>
      )}
    </section>
  );
}
