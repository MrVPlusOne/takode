import { createContext, useEffect, useState } from "react";
import { useStore } from "../store.js";
import { hydrateQuestDetail } from "../utils/quest-detail-hydration.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { QuestInlineLink } from "./QuestInlineLink.js";
import type { QuestLinkSurface } from "./quest-link-surface.js";

/**
 * Quest whose completion summary belongs above its Quiz in the current turn.
 * Only the leader quest thread's completion host turn provides a value, so
 * Quizzes elsewhere (worker feeds, Main, Playground) render unchanged.
 */
export const QuestCompletionSummaryContext = createContext<string | null>(null);

/**
 * Compact "Quest complete" card showing the quest's final debrief TLDR, expandable to
 * the full debrief. It reads the server quest record, revalidated whenever a live
 * quest update changes the quest's version, so a reopened quest hides the card and a
 * recompleted quest shows its current debrief. Renders nothing until the quest is
 * done, when cancelled, or when no debrief was recorded.
 */
export function QuestCompletionSummaryCard({
  questId,
  sessionId,
  questLinkSurface,
}: {
  questId: string;
  /** Leader session whose completed board can identify the quest as done before its record loads. */
  sessionId?: string;
  questLinkSurface: QuestLinkSurface;
}) {
  const key = questId.toLowerCase();
  const quest = useStore((s) => s.questDetails?.get(key) ?? s.quests?.find((q) => q.questId === key) ?? null);
  const onCompletedBoard = useStore((s) =>
    sessionId
      ? (s.sessionCompletedBoards?.get(sessionId)?.some((row) => row.questId.toLowerCase() === key) ?? false)
      : false,
  );
  const revision = useStore((s) => {
    const preview = s.questTitlePreviews?.get(key);
    return preview ? `${preview.version}:${preview.updatedAt ?? 0}` : "";
  });
  const [expanded, setExpanded] = useState(false);
  // Only fetch the full record once the quest is known done, so open quest threads stay request-free.
  const knownDone = onCompletedBoard || quest?.status === "done";
  useEffect(() => {
    if (!knownDone) return;
    // A failed revalidation keeps the cached record; the next live quest update retries.
    hydrateQuestDetail(key).catch((error: unknown) => console.warn(`[quest-summary] ${key} refresh failed`, error));
  }, [key, knownDone, revision]);
  if (!quest || quest.status !== "done" || quest.cancelled) return null;
  const debrief = quest.debrief?.trim() ?? "";
  const tldr = quest.debriefTldr?.trim() ?? "";
  if (!tldr && !debrief) return null;
  const canExpand = tldr !== "" && debrief !== "" && debrief !== tldr;

  return (
    <section
      className="mt-3 min-w-0 max-w-3xl rounded-lg border border-cc-border bg-cc-card px-3 py-2.5"
      aria-label="Quest complete"
      data-testid="quest-completion-summary"
    >
      <div className="flex min-w-0 items-baseline gap-1.5 text-[11px] text-cc-muted">
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.08em] text-cc-success">
          Quest complete
        </span>
        <QuestInlineLink
          questId={quest.questId}
          className="shrink-0 font-mono-code text-cc-primary hover:underline"
          surface={questLinkSurface}
        />
        <span className="min-w-0 truncate">{quest.title}</span>
      </div>
      <div className="mt-1.5 min-w-0 text-sm text-cc-fg">
        <MarkdownContent
          text={expanded && canExpand ? debrief : tldr || debrief}
          size="md"
          variant="conservative"
          sessionId={sessionId}
          wrapLongContent
          questLinkSurface={questLinkSurface}
        />
      </div>
      {canExpand && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="mt-1 cursor-pointer rounded-md py-0.5 text-[11px] font-medium text-cc-primary hover:text-cc-primary-hover"
        >
          {expanded ? "Show less" : "Show full debrief"}
        </button>
      )}
    </section>
  );
}
