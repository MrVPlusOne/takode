import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { backdropClickProps } from "../utils/backdrop-click.js";
import { useOutsidePress } from "../hooks/useOutsidePress.js";
import { MarkdownTableCopyButton } from "./MarkdownTableCopyButton.js";

/**
 * A table in rendered Markdown, with Copy and View table. The buttons float over the table's top
 * corner and show only while the pointer is over the table (or a button has keyboard focus), so a
 * page of tables reads cleanly. Touch has no hover: a tap on the table shows them until a tap
 * lands elsewhere.
 */
export function MarkdownTableWithViewer({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [touched, setTouched] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);
  useOutsidePress([blockRef], () => setTouched(false), touched);
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") setTouched(true);
  };

  return (
    <>
      <div
        className="group/table relative my-2"
        ref={blockRef}
        data-markdown-table=""
        data-controls-shown={touched ? "" : undefined}
        onPointerDown={onPointerDown}
      >
        {/* Controls, not content: kept out of selections and copies. Hidden ones take no taps. */}
        <div
          className="pointer-events-none absolute right-1 top-1 z-10 flex select-none items-center gap-1 opacity-0 transition-opacity group-hover/table:pointer-events-auto group-hover/table:opacity-100 group-data-[controls-shown]/table:pointer-events-auto group-data-[controls-shown]/table:opacity-100 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100"
          data-copy-exclude=""
          data-testid="markdown-table-controls"
        >
          <MarkdownTableCopyButton tableRef={blockRef} />
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-cc-border bg-cc-card text-cc-muted shadow-sm hover:bg-cc-hover hover:text-cc-fg transition-colors cursor-pointer"
            aria-label="View table"
            title="View table"
            data-testid="markdown-table-expand"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
              <path d="M6 2H3.5A1.5 1.5 0 002 3.5V6M10 2h2.5A1.5 1.5 0 0114 3.5V6M14 10v2.5A1.5 1.5 0 0112.5 14H10M6 14H3.5A1.5 1.5 0 012 12.5V10" />
            </svg>
          </button>
        </div>
        <div className="overflow-x-auto">
          <MarkdownTable compact>{children}</MarkdownTable>
        </div>
      </div>
      {expanded && <MarkdownTableDialog onClose={() => setExpanded(false)}>{children}</MarkdownTableDialog>}
    </>
  );
}

function MarkdownTable({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return (
    <table
      className={
        compact
          ? "min-w-full text-sm border border-cc-border rounded-lg overflow-hidden"
          : "min-w-full text-sm border border-cc-border rounded-xl overflow-hidden bg-cc-card shadow-[0_0_0_1px_rgba(255,255,255,0.03)]"
      }
    >
      {children}
    </table>
  );
}

function MarkdownTableDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prev;
    };
  }, [handleKeyDown]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-3 py-4 sm:px-6"
      {...backdropClickProps(onClose)}
      data-testid="markdown-table-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Expanded table view"
        className="h-[calc(100vh-2rem)] w-[calc(100vw-1.5rem)] max-w-none rounded-2xl border border-cc-border bg-cc-bg shadow-2xl overflow-hidden flex flex-col sm:h-[calc(100vh-3rem)] sm:w-[calc(100vw-3rem)]"
        onClick={(e) => e.stopPropagation()}
        data-testid="markdown-table-dialog"
      >
        <div className="flex items-center justify-between gap-3 border-b border-cc-border bg-cc-card px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-cc-fg">Table View</div>
            <div className="text-xs text-cc-muted">Expanded to use the full page width.</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-cc-muted hover:bg-cc-hover hover:text-cc-fg transition-colors cursor-pointer"
            aria-label="Close table view"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-4">
          <MarkdownTable>{children}</MarkdownTable>
        </div>
      </div>
    </div>,
    document.body,
  );
}
