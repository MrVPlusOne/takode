import { useCallback, useMemo, useState, type RefObject } from "react";
import { copyRichText, writeClipboardText } from "../utils/copy-utils.js";
import { readTableRows, tableToAlignedText, tableToHtml, tableToMarkdown, tableToTsv } from "../utils/table-copy.js";
import { slackCodeBlock } from "../utils/slack-copy.js";
import { ContextMenu, useMenuButton, type ContextMenuItem } from "./ContextMenu.js";

/**
 * Copy one rendered table in a chosen format. Each format suits a destination: Slack's own table and
 * spreadsheets take tab-separated cells (documents take the HTML table copied alongside), a code block
 * keeps columns lined up anywhere monospace, and Markdown suits Markdown documents and agents.
 */
export function MarkdownTableCopyButton({ tableRef }: { tableRef: RefObject<HTMLElement | null> }) {
  const { menu, toggle, close } = useMenuButton();
  const [copied, setCopied] = useState(false);

  const copy = useCallback(
    (write: (rows: string[][]) => Promise<void>) => {
      const table = tableRef.current?.querySelector("table");
      if (!table) return;
      write(readTableRows(table))
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
        .catch(console.error);
    },
    [tableRef],
  );

  const items = useMemo<ContextMenuItem[]>(
    () => [
      {
        // Slack builds its own table from the tab-separated text even with the HTML table alongside;
        // documents and email take the HTML table.
        label: "Copy as table (Slack, sheets, docs)",
        onClick: () => copy((rows) => copyRichText(tableToHtml(rows), tableToTsv(rows))),
      },
      {
        label: "Copy as code block",
        onClick: () => copy((rows) => slackCodeBlock(tableToAlignedText(rows)).write()),
      },
      {
        label: "Copy as Markdown",
        onClick: () => copy((rows) => writeClipboardText(tableToMarkdown(rows))),
      },
    ],
    [copy],
  );

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-1.5 rounded-lg border border-cc-border bg-cc-card px-2.5 py-1 text-[11px] font-medium text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
        data-testid="markdown-table-copy"
        aria-label="Copy table"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="w-3 h-3">
          {copied ? (
            <path d="M3 8.5l3.5 3.5 6.5-8" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <>
              <rect x="5.5" y="5.5" width="7" height="8" rx="1" />
              <path d="M3.5 10.5V3a1 1 0 011-1h5.5" />
            </>
          )}
        </svg>
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
      {menu && <ContextMenu {...menu} items={items} onClose={close} />}
    </>
  );
}
