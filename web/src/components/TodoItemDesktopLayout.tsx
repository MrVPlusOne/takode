/**
 * The to-do sheet's parts and its desktop layout. The sheet builds each part once (the text or its
 * editor, the settings, the actions) and a layout arranges them: one column on phones, with the
 * status control under the thumb, and on desktop a wide dialog with the text on the left and every
 * control in a side panel on the right, so reading and changing the to-do stay apart.
 */
import type { ReactNode } from "react";
import { TODO_STATUSES, type TodoStatus } from "../../shared/todo-types.js";

/** A button-like action of the sheet; null when the sheet does not offer it. */
export interface TodoSheetAction {
  disabled: boolean;
  run: () => void;
}

/** Everything a layout places, built once by the sheet. */
export interface TodoItemParts {
  editing: boolean;
  pending: boolean;
  /** The to-do's text, or its editor while editing. */
  content: ReactNode;
  category: ReactNode;
  due: ReactNode | null;
  quests: ReactNode | null;
  moveUp: TodoSheetAction | null;
  moveDown: TodoSheetAction | null;
  archive: (TodoSheetAction & { label: string }) | null;
  provenance: ReactNode;
  /** Updated or Done time, or the short Undo after completing. */
  footerStatus: ReactNode;
  pageLink: ReactNode | null;
  error: ReactNode | null;
  startEdit: () => void;
  cancelEdit: () => void;
  /** `hint` names the save and new-line keys from the send-key setting. */
  saveEdit: TodoSheetAction & { busy: boolean; hint: string };
  status: TodoStatusControlState | null;
}

export interface TodoStatusControlState {
  value: TodoStatus;
  set: (status: TodoStatus, control: Element) => void;
  disabled: (status: TodoStatus) => boolean;
  busy: (status: TodoStatus) => boolean;
}

const STATUS_LABELS: Record<TodoStatus, string> = { todo: "Todo", doing: "Doing", done: "Done" };
const STATUS_SELECTED_TONES: Record<TodoStatus, string> = {
  todo: "bg-cc-hover text-cc-fg",
  doing: "bg-cc-primary/15 text-cc-primary",
  done: "bg-cc-success/15 text-cc-success",
};

/** Desktop-sized buttons: a mouse needs no finger-sized targets. */
const BUTTON_CLASS =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-cc-border px-2.5 text-[13px] text-cc-fg hover:bg-cc-hover disabled:opacity-40";
const QUIET_BUTTON_CLASS =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-[13px] text-cc-muted hover:bg-cc-hover hover:text-cc-fg disabled:opacity-40 disabled:hover:bg-transparent";
const PRIMARY_BUTTON_CLASS =
  "inline-flex h-8 items-center rounded-md bg-cc-primary px-3.5 text-[13px] font-medium text-white hover:bg-cc-primary-hover disabled:opacity-60";

/** Todo, Doing and Done as one segmented control: finger-sized on phones, equal cells on desktop. */
export function TodoStatusControl({ status, size }: { status: TodoStatusControlState; size: "phone" | "fill" }) {
  const cell = size === "phone" ? "min-h-10 px-3.5 text-sm" : "h-7 justify-center px-3 text-[13px]";
  return (
    <div
      role="group"
      aria-label="Status"
      className={`rounded-lg border border-cc-border p-0.5 ${size === "fill" ? "grid grid-cols-3" : "flex"}`}
    >
      {TODO_STATUSES.map((value) => (
        <button
          key={value}
          type="button"
          onClick={(event) => status.set(value, event.currentTarget)}
          disabled={status.disabled(value)}
          aria-pressed={status.value === value}
          aria-busy={status.busy(value) || undefined}
          className={`inline-flex items-center rounded-md disabled:opacity-60 ${cell} ${
            status.value === value ? STATUS_SELECTED_TONES[value] : "text-cc-muted hover:text-cc-fg"
          }`}
        >
          {STATUS_LABELS[value]}
        </button>
      ))}
    </div>
  );
}

/** Save and Cancel under the editor. */
function EditActions({ parts }: { parts: TodoItemParts }) {
  return (
    <div className="mt-2 flex items-center justify-end gap-2">
      <span className="mr-auto text-[12px] text-cc-muted">{parts.saveEdit.hint}; Cancel: Esc</span>
      <button type="button" onClick={parts.cancelEdit} disabled={parts.pending} className={BUTTON_CLASS}>
        Cancel
      </button>
      <button
        type="button"
        onClick={parts.saveEdit.run}
        disabled={parts.saveEdit.disabled}
        aria-busy={parts.saveEdit.busy || undefined}
        className={PRIMARY_BUTTON_CLASS}
        data-testid="todo-preview-save"
      >
        Save
      </button>
    </div>
  );
}

function EditButton({ parts }: { parts: TodoItemParts }) {
  return (
    <button type="button" onClick={parts.startEdit} className={BUTTON_CLASS}>
      <PencilIcon />
      Edit
    </button>
  );
}

/** A small muted heading over a setting in a stacked list. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-cc-muted">{label}</div>
      {children}
    </div>
  );
}

/**
 * The desktop sheet: the text on the left, with Edit under it, and every control in a side panel
 * on the right, like an issue in a tracker: Status, Category, Due, Quests, the page's quiet Move and
 * Archive actions, then who added and changed the to-do and when.
 */
export function TodoItemDesktopLayout({ parts }: { parts: TodoItemParts }) {
  const { moveUp, moveDown, archive } = parts;
  return (
    <div className="flex min-h-0 flex-1 border-t border-cc-border/60">
      <div className="min-w-0 flex-1 overflow-y-auto px-6 pb-6 pt-4 text-[15px]">
        {parts.content}
        {parts.editing ? (
          <EditActions parts={parts} />
        ) : (
          <div className="mt-4">
            <EditButton parts={parts} />
          </div>
        )}
        {parts.error && <div className="mt-3">{parts.error}</div>}
      </div>
      <aside className="w-[23rem] shrink-0 space-y-4 overflow-y-auto border-l border-cc-border/60 bg-cc-hover/30 px-4 py-4 text-[13px]">
        {parts.status && (
          <Field label="Status">
            <TodoStatusControl status={parts.status} size="fill" />
          </Field>
        )}
        <Field label="Category">{parts.category}</Field>
        {parts.due && <Field label="Due">{parts.due}</Field>}
        {parts.quests && <Field label="Quests">{parts.quests}</Field>}
        {archive && (
          <div className="flex flex-wrap gap-1 border-t border-cc-border/60 pt-3">
            {moveUp && moveDown && (
              <>
                <button type="button" disabled={moveUp.disabled} onClick={moveUp.run} className={QUIET_BUTTON_CLASS}>
                  ↑ Move up
                </button>
                <button
                  type="button"
                  disabled={moveDown.disabled}
                  onClick={moveDown.run}
                  className={QUIET_BUTTON_CLASS}
                >
                  ↓ Move down
                </button>
              </>
            )}
            <button type="button" disabled={archive.disabled} onClick={archive.run} className={QUIET_BUTTON_CLASS}>
              {archive.label}
            </button>
          </div>
        )}
        <div className="space-y-1 border-t border-cc-border/60 pt-3 text-[12px] text-cc-muted">
          {parts.provenance}
          <p data-testid="todo-preview-footer-status">{parts.footerStatus}</p>
          {parts.pageLink && <p>{parts.pageLink}</p>}
        </div>
      </aside>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-3.5 w-3.5" aria-hidden>
      <path d="M10.5 2.5l3 3L6 13H3v-3l7.5-7.5z" strokeLinejoin="round" />
    </svg>
  );
}
