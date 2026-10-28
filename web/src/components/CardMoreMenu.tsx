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
      {task?.running && (
        <span className="mr-1 whitespace-nowrap text-[12px] text-cc-muted" role="status">
          {task.running}…
        </span>
      )}
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
      {task?.error && (
        <button
          type="button"
          role="alert"
          onClick={task.dismiss}
          className="absolute right-0 top-full z-20 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-cc-error/40 bg-cc-card px-2.5 py-1.5 text-left text-xs text-cc-error shadow-md"
        >
          {task.error}
        </button>
      )}
      {menu && <ContextMenu {...menu} items={items} onClose={close} widthClassName="w-fit min-w-[200px]" />}
    </span>
  );
}

/** What a card's menu is doing in the background: a running export, or the error it ended with. */
export interface CardTask {
  running: string | null;
  error: string | null;
  dismiss: () => void;
}

/**
 * Runs a card's export while showing that it runs and, if it fails, why. `exportItems` makes the
 * menu's Export submenu from the formats the card offers; `start` runs one directly.
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
  const exportItems = (formats: readonly ExportFormat[]): ContextMenuItem => ({
    label: "Export",
    onClick: () => {},
    children: formats.map((format) => ({ label: EXPORT_FORMAT_LABELS[format], onClick: () => start(format) })),
  });
  const task: CardTask = { running, error, dismiss: () => setError(null) };
  return { exportItems, start, task };
}
