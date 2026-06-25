import { MarkdownContent } from "./MarkdownContent.js";
import type { QuestQuizItem } from "../types.js";

interface QuestQuizSectionProps {
  items?: QuestQuizItem[];
  variant?: "detail" | "compact" | "inline";
  sessionId?: string;
  questId?: string;
  questTitle?: string;
  collapsed?: boolean;
  onSessionNavigate?: () => void;
}

export function QuestQuizSection({
  items,
  variant = "detail",
  sessionId,
  questId,
  questTitle,
  collapsed = false,
  onSessionNavigate,
}: QuestQuizSectionProps) {
  const quizItems = items ?? [];
  if (quizItems.length === 0) return null;

  const visibleItems = variant === "compact" ? quizItems.slice(0, 2) : quizItems;
  const remaining = Math.max(0, quizItems.length - visibleItems.length);
  const testId =
    variant === "compact" ? "quest-quiz-compact" : variant === "inline" ? "quest-quiz-inline" : "quest-quiz-section";
  const body = (
    <div className={variant === "compact" ? "space-y-1.5" : "space-y-2"}>
      {visibleItems.map((item, index) => (
        <QuestQuizItemRow
          key={item.id || `${item.question}:${index}`}
          item={item}
          index={index}
          variant={variant}
          sessionId={sessionId}
          onSessionNavigate={onSessionNavigate}
        />
      ))}
      {remaining > 0 && <div className="text-[10px] text-cc-muted/60">+{remaining} more in quest details</div>}
    </div>
  );

  if (collapsed) {
    return (
      <details className="min-w-0 max-w-full rounded-lg border border-cc-border bg-cc-input-bg" data-testid={testId}>
        <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-cc-fg hover:bg-cc-hover/40">
          <span className="min-w-0 truncate">Quiz</span>
          <span className="shrink-0 text-[10px] font-normal text-cc-muted/70">
            {quizItems.length} item{quizItems.length === 1 ? "" : "s"}
          </span>
        </summary>
        <div className="border-t border-cc-border/70 px-3 py-2">{body}</div>
      </details>
    );
  }

  return (
    <section className={sectionClassName(variant)} aria-label="Quest quiz" data-testid={testId}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-cc-muted/70">Quiz</div>
          {variant === "inline" && (
            <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-[11px] text-cc-muted">
              {questId && <span className="shrink-0 font-mono-code text-cc-info">{questId}</span>}
              {questTitle && <span className="min-w-0 truncate">{questTitle}</span>}
            </div>
          )}
        </div>
        <div className="shrink-0 text-[10px] text-cc-muted/60">
          {quizItems.length} item{quizItems.length === 1 ? "" : "s"}
        </div>
      </div>
      {body}
    </section>
  );
}

function sectionClassName(variant: "detail" | "compact" | "inline"): string {
  if (variant === "compact") return "mt-2 border-t border-cc-border/70 pt-2";
  if (variant === "inline") return "mt-3 min-w-0 max-w-3xl rounded-lg border border-cc-border bg-cc-card px-3 py-2.5";
  return "min-w-0 max-w-full space-y-2";
}

function QuestQuizItemRow({
  item,
  index,
  variant,
  sessionId,
  onSessionNavigate,
}: {
  item: QuestQuizItem;
  index: number;
  variant: "detail" | "compact" | "inline";
  sessionId?: string;
  onSessionNavigate?: () => void;
}) {
  return (
    <div
      className={
        variant === "compact"
          ? "min-w-0 rounded-md bg-cc-hover/25 px-2 py-1.5"
          : variant === "inline"
            ? "min-w-0 max-w-full overflow-hidden rounded-md bg-cc-hover/20 px-2 py-1.5"
            : "min-w-0 max-w-full overflow-hidden rounded-lg border border-cc-border bg-cc-input-bg px-3 py-2"
      }
      data-testid="quest-quiz-item"
    >
      <div className="flex min-w-0 gap-2">
        <span className="mt-0.5 shrink-0 font-mono-code text-[10px] text-cc-muted/70">{index + 1}</span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className={variant === "compact" ? "text-[11px] leading-snug text-cc-fg" : "text-sm text-cc-fg"}>
            {item.question}
          </div>
          <details className="group min-w-0 text-xs text-cc-muted">
            <summary className="inline-flex cursor-pointer select-none items-center rounded-md px-0 py-0.5 text-[11px] font-medium text-cc-primary hover:text-cc-primary-hover">
              <span className="group-open:hidden">Show answer</span>
              <span className="hidden group-open:inline">Hide answer</span>
            </summary>
            <div className={answerClassName(variant)}>
              <MarkdownContent
                text={item.answer}
                size={variant === "compact" ? "sm" : "md"}
                variant="conservative"
                sessionId={sessionId}
                wrapLongContent
                onSessionNavigate={onSessionNavigate}
              />
              {item.source && <div className="mt-1 text-[10px] text-cc-muted/60">Source: {item.source}</div>}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function answerClassName(variant: "detail" | "compact" | "inline"): string {
  const textSize = variant === "compact" ? "text-xs" : "text-sm";
  return `mt-1 min-w-0 max-w-full overflow-hidden rounded-md border border-cc-border/70 bg-cc-bg/50 px-2 py-1.5 ${textSize} text-cc-fg`;
}
