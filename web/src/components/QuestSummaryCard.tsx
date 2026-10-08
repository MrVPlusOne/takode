import { createContext, useContext, useEffect, useState } from "react";
import { useStore } from "../store.js";
import type { QuestmasterTask } from "../types.js";
import { hydrateQuestDetail } from "../utils/quest-detail-hydration.js";
import { getQuestRecencyTs } from "../utils/quest-editor-helpers.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { QuestInlineLink } from "./QuestInlineLink.js";
import type { QuestLinkSurface } from "./quest-link-surface.js";

/**
 * Whether quest summary cards may load quest records from the server. The Playground
 * turns this off so its fixtures never fetch, or show, real quests' records.
 */
export const QuestRecordFetchContext = createContext(true);

/**
 * The server's full record for one quest, from the browser store. It is fetched
 * (deduped and ETag-validated) only when no record is cached or the quest's live
 * title preview is newer than it, so reopening a thread whose record is current
 * makes no request while edits, reopening and recompletion still show up. Without
 * fetching (see QuestRecordFetchContext) it shows only what the store already holds.
 */
export function useQuestRecord(questId: string): QuestmasterTask | null {
  const key = questId.toLowerCase();
  const quest = useStore((s) => s.questDetails?.get(key) ?? s.quests?.find((q) => q.questId === key) ?? null);
  const preview = useStore((s) => s.questTitlePreviews?.get(key) ?? null);
  const fetchEnabled = useContext(QuestRecordFetchContext);
  const stale =
    !quest ||
    (preview !== null &&
      (preview.version > quest.version ||
        (preview.version === quest.version && (preview.updatedAt ?? 0) > getQuestRecencyTs(quest))));
  useEffect(() => {
    if (!stale || !fetchEnabled) return;
    // A failed load keeps the cached record; the next live quest update retries.
    hydrateQuestDetail(key).catch((error: unknown) => console.warn(`[quest-summary] ${key} refresh failed`, error));
  }, [key, stale, preview, fetchEnabled]);
  return quest;
}

/**
 * Compact card in a leader quest thread: a labeled quest link and title, a short
 * Markdown summary, and a toggle to the full text when it adds more.
 */
export function QuestSummaryCard({
  quest,
  label,
  labelClassName,
  summary,
  fullText,
  expandLabel,
  testId,
  className = "",
  sessionId,
  questLinkSurface,
}: {
  quest: QuestmasterTask;
  label: string;
  labelClassName: string;
  summary: string;
  /** Shown when expanded; the toggle appears only when it differs from the summary. */
  fullText: string;
  expandLabel: string;
  testId: string;
  /** Placement spacing from the host surface. */
  className?: string;
  sessionId?: string;
  questLinkSurface: QuestLinkSurface;
}) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = fullText !== "" && fullText !== summary;

  return (
    <section
      className={`min-w-0 max-w-3xl rounded-lg border border-cc-border bg-cc-card px-3 py-2.5 ${className}`}
      aria-label={label}
      data-testid={testId}
    >
      <div className="flex min-w-0 items-baseline gap-1.5 text-[11px] text-cc-muted">
        <span className={`shrink-0 text-[10px] font-medium uppercase tracking-[0.08em] ${labelClassName}`}>
          {label}
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
          text={expanded && canExpand ? fullText : summary}
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
          {expanded ? "Show less" : expandLabel}
        </button>
      )}
    </section>
  );
}
