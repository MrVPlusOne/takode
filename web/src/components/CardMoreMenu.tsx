import { useCallback, useState } from "react";
import { ContextMenu, useMenuButton, type ContextMenuItem } from "./ContextMenu.js";
import { EXPORT_FORMAT_LABELS, type ExportFormat } from "../utils/artifact-export.js";

/**
 * The "More options" button of an artifact card's header (reports, drafts, visuals): the card's
 * less common actions, such as opening it in the Library, copying its Markdown and exporting it,
 * stay in this menu so the header keeps only open, read-aloud and copy buttons.
 */
export function CardMoreMenu({ items, task }: { items: ContextMenuItem[]; task?: CardTask }) {
  const { menu, toggle, close } = useMenuButton();
  return (
    <span className="relative inline-flex shrink-0 items-center">
      <TaskRunning task={task} />
      <button
        type="button"
        onClick={toggle}
        aria-label="More options"
        title="More options"
        aria-haspopup="menu"
        aria-expanded={!!menu}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg pointer-coarse:h-8 pointer-coarse:w-8"
        data-testid="card-more-menu"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>
      <TaskError task={task} />
      {menu && <ContextMenu {...menu} items={items} onClose={close} widthClassName="w-fit min-w-[200px]" />}
    </span>
  );
}

/**
 * The Download button of a file or artifact shown large (the file viewer, the Library): with
 * exports to offer it opens a menu of Download and the exports (`useCardExport().saveItems`), else
 * its one item downloads right away. `disabledReason` grays it out and says why.
 */
export function DownloadButton({
  items,
  task,
  disabledReason,
}: {
  items: ContextMenuItem[];
  task?: CardTask;
  disabledReason?: string;
}) {
  const { menu, toggle, close } = useMenuButton();
  const direct = items.length === 1 && !items[0].children ? items[0] : null;
  const title = disabledReason ?? (direct ? "Download" : "Download or export");
  return (
    <span className="relative inline-flex shrink-0 items-center">
      <TaskRunning task={task} />
      <button
        type="button"
        onClick={(event) => {
          if (disabledReason) return;
          if (direct) direct.onClick();
          else toggle(event);
        }}
        // aria-disabled rather than disabled, so the explaining tooltip still shows on hover.
        aria-disabled={disabledReason ? true : undefined}
        aria-haspopup={direct ? undefined : "menu"}
        aria-expanded={direct ? undefined : !!menu}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
          disabledReason
            ? "cursor-default text-cc-muted/50"
            : "cursor-pointer text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
        }`}
        aria-label={title}
        title={title}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
          <path d="M8 2.5v7.5M4.75 7l3.25 3.25L11.25 7M3 13.5h10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <TaskError task={task} />
      {/* A set width: opened at the window's right edge and moved in, a fitted menu stretches to the edge. */}
      {menu && <ContextMenu {...menu} items={items} onClose={close} widthClassName="w-56" />}
    </span>
  );
}

function TaskRunning({ task }: { task?: CardTask }) {
  if (!task?.running) return null;
  return (
    <span className="mr-1 whitespace-nowrap text-[12px] text-cc-muted" role="status">
      {task.running}…
    </span>
  );
}

function TaskError({ task }: { task?: CardTask }) {
  if (!task?.error) return null;
  return (
    <button
      type="button"
      role="alert"
      onClick={task.dismiss}
      className="absolute right-0 top-full z-20 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-cc-error/40 bg-cc-card px-2.5 py-1.5 text-left text-xs text-cc-error shadow-md"
    >
      {task.error}
    </button>
  );
}

/** What a card's menu is doing in the background: a running export, or the error it ended with. */
export interface CardTask {
  running: string | null;
  error: string | null;
  dismiss: () => void;
}

/** How a menu names an export on a row of its own. */
const EXPORT_AS_LABELS: Record<ExportFormat, string> = {
  markdown: "Export as Markdown (.md)",
  pdf: "Export as PDF (.pdf)",
  png: "Export as image (.png)",
  html: "Export as web page (.html)",
};

/**
 * Runs a card's export while showing that it runs and, if it fails, why. `saveItems` makes the
 * menu items that save it from the formats it offers; `start` runs one directly.
 */
export function useCardExport(run: (format: ExportFormat) => Promise<void>) {
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = useCallback(
    (format: ExportFormat) => {
      setError(null);
      setRunning("Exporting");
      run(format)
        .catch((reason: Error) => setError(reason.message || "Export failed."))
        .finally(() => setRunning(null));
    },
    [run],
  );
  /**
   * Download and Export together, the same everywhere: Markdown, the content as written, is the
   * Download; the other formats are exports, each on a row of its own when there is one or `flat`
   * asks (a menu of its own), else in an Export submenu.
   */
  const saveItems = (formats: readonly ExportFormat[], { flat = false } = {}): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    if (formats.includes("markdown")) items.push({ label: "Download (.md)", onClick: () => start("markdown") });
    const exports = formats.filter((format) => format !== "markdown");
    if (flat || exports.length === 1) {
      items.push(...exports.map((format) => ({ label: EXPORT_AS_LABELS[format], onClick: () => start(format) })));
    } else if (exports.length > 0) {
      items.push({
        label: "Export",
        onClick: () => {},
        children: exports.map((format) => ({ label: EXPORT_FORMAT_LABELS[format], onClick: () => start(format) })),
      });
    }
    return items;
  };
  const task: CardTask = { running, error, dismiss: () => setError(null) };
  return { saveItems, start, task };
}
