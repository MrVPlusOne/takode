import { useCallback, useRef, useState, type ReactNode } from "react";
import { messageCopyForSlack } from "../utils/slack-copy.js";

/**
 * A message draft (a ```draft fenced block), shown as the formatted message it will become, with one
 * button that copies exactly the draft for Slack: formatting kept, nothing around it. `children` is the
 * draft rendered as Markdown; `label` (the draft's title, or which part of a post it is) replaces "Draft".
 */
export function MarkdownDraftCard({
  children,
  label,
  actions,
}: {
  children: ReactNode;
  label?: string;
  /** Shown before the copy button, such as the draft's Library link. */
  actions?: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    if (!bodyRef.current) return;
    messageCopyForSlack(bodyRef.current)
      .write()
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(console.error);
  }, []);

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-cc-border bg-cc-card" data-markdown-draft="">
      {/* Controls, not content: kept out of selections and copies. */}
      <div
        className="flex select-none items-center gap-2 border-b border-cc-border bg-cc-hover/40 px-3 py-1.5"
        data-copy-exclude=""
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          className="h-3.5 w-3.5 text-cc-muted"
        >
          <path d="M3 13l1-3.5L11 2.5a1.4 1.4 0 012 2L6 11.5 3 13z" strokeLinejoin="round" />
        </svg>
        {label ? (
          <span className="min-w-0 truncate text-[12px] text-cc-muted">{label}</span>
        ) : (
          <span className="text-[11px] font-medium uppercase tracking-wide text-cc-muted">Draft</span>
        )}
        <span className="ml-auto" />
        {actions}
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-7 items-center gap-1.5 rounded-lg bg-cc-primary px-2.5 text-[12px] font-medium text-white hover:bg-cc-primary-hover pointer-coarse:min-h-9 pointer-coarse:px-3"
          data-testid="markdown-draft-copy"
        >
          {copied ? "Copied" : "Copy for Slack"}
        </button>
      </div>
      <div ref={bodyRef} className="px-3 py-2.5">
        {children}
      </div>
    </div>
  );
}
