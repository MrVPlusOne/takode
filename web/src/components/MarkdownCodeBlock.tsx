/**
 * A fenced code block in rendered Markdown: syntax highlighting, a copy button, and a capped
 * height. A long block (a pasted JSON document, a log) shows a scrollable window instead of its
 * full height, so readers can scroll past it, and can be expanded to full height and back.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { highlightCode } from "../utils/syntax-highlighting.js";
import { CodeCopyButton } from "./CodeCopyButton.js";

export function CodeBlock({
  lang,
  children,
  wrapLongContent,
}: {
  lang: string;
  children: ReactNode;
  wrapLongContent: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const codeRef = useRef<HTMLElement>(null);
  const getText = useCallback(() => codeRef.current?.textContent ?? "", []);
  const raw = typeof children === "string" ? children : String(children ?? "");
  // react-markdown appends a trailing newline to fenced code.
  const code = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  const highlighted = useMemo(() => (lang ? highlightCode(code, lang) : null), [lang, code]);

  // Every block is capped by CSS, so nothing jumps after layout; only one taller than the cap
  // (measured, so wrapped lines count) gets the line count and the expand control.
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    const pre = preRef.current;
    if (!pre || expanded) return;
    const measure = () => setOverflows(pre.scrollHeight > pre.clientHeight + 1);
    measure();
    // Width changes rewrap long lines and can push a block past the cap.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(pre);
    return () => observer?.disconnect();
  }, [expanded]);
  const long = overflows || expanded;

  /** Collapsing a block read to its end would leave the reader far below it; bring its top back. */
  const collapse = () => {
    setExpanded(false);
    requestAnimationFrame(() => {
      const root = rootRef.current;
      if (root && root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: "start" });
    });
  };
  const lines = `${code.split("\n").length.toLocaleString()} lines`;

  return (
    <div
      ref={rootRef}
      className="group/code relative my-2 overflow-hidden rounded-lg border border-cc-border"
      data-testid="code-block"
      data-expanded={long ? String(expanded) : undefined}
    >
      {lang || long ? (
        <div className="flex items-center gap-2 border-b border-cc-border bg-cc-code-bg/80 px-3 py-1.5">
          <span className="text-[10px] font-mono-code uppercase tracking-wider text-cc-muted">{lang}</span>
          <span className="ml-auto flex items-center gap-1">
            {long && (
              <>
                <span className="text-[10px] text-cc-muted" data-testid="code-block-line-count">
                  {lines}
                </span>
                <button
                  type="button"
                  onClick={() => (expanded ? collapse() : setExpanded(true))}
                  aria-label={expanded ? "Collapse code" : `Show all ${lines}`}
                  aria-expanded={expanded}
                  title={expanded ? "Collapse code" : `Show all ${lines}`}
                  className="rounded p-1 text-cc-muted hover:bg-white/10 hover:text-cc-code-fg"
                  data-testid="code-block-toggle"
                >
                  <ExpandGlyph expanded={expanded} />
                </button>
              </>
            )}
            <CodeCopyButton getText={getText} />
          </span>
        </div>
      ) : (
        <div className="absolute right-1.5 top-1.5 z-10">
          <CodeCopyButton getText={getText} />
        </div>
      )}
      <pre
        ref={preRef}
        className={`bg-cc-code-bg px-2 py-2 font-mono-code text-[12px] leading-relaxed text-cc-code-fg sm:px-3 sm:py-2.5 sm:text-[13px] ${
          wrapLongContent
            ? "overflow-x-hidden whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
            : "overflow-x-auto"
        } ${expanded ? "" : "max-h-[22rem] overflow-y-auto overscroll-y-contain"}`}
        data-testid="code-block-pre"
      >
        {highlighted ? (
          <code ref={codeRef} dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <code ref={codeRef}>{children}</code>
        )}
      </pre>
      {/* At the end of an expanded block, collapsing must not need a scroll back to its top. */}
      {expanded && (
        <button
          type="button"
          onClick={collapse}
          className="flex w-full items-center justify-center gap-1.5 border-t border-cc-border bg-cc-code-bg/80 py-1.5 text-xs text-cc-muted hover:text-cc-fg"
          data-testid="code-block-collapse-bar"
        >
          <svg
            viewBox="0 0 16 16"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M3.5 10 8 5.5 12.5 10" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Collapse
        </button>
      )}
    </div>
  );
}

/** Two arrows apart (expand) or together (collapse). */
function ExpandGlyph({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <path
        d={expanded ? "M5 2.5 8 5.5l3-3M5 13.5l3-3 3 3" : "M5 5.5 8 2.5l3 3M5 10.5l3 3 3-3"}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
