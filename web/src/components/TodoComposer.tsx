import { useCallback, useEffect, useRef, useState, type FocusEvent } from "react";
import { deriveTodoMarkdown } from "../../shared/todo-markdown.js";
import type { TodoCategory, TodoState } from "../../shared/todo-types.js";
import { api } from "../api.js";

export const TODO_SELECT_CLASS =
  "takode-native-select h-8 min-w-0 cursor-pointer rounded-lg border border-cc-border bg-cc-bg px-2 text-[13px] text-cc-fg outline-none focus:border-cc-primary disabled:opacity-60 pointer-coarse:h-10";

/**
 * The box for adding to-dos, at the top of the list (from New), under a category (its +) or under
 * a row (Alt+Enter). Enter adds the to-do and clears the box for the next one; Shift+Enter starts a
 * details line; clicking away adds what was typed and closes the box; Escape discards. A failed save
 * keeps the draft with Retry and Copy draft. The category dropdown says where it goes; choosing
 * another category drops the "below this row" position.
 */
export function TodoComposer({
  categories,
  categoryId: initialCategoryId,
  afterItemId: initialAfterItemId,
  onState,
  onClose,
}: {
  categories: TodoCategory[];
  categoryId: string;
  afterItemId?: string;
  onState: (state: TodoState) => void;
  onClose: () => void;
}) {
  const [markdown, setMarkdown] = useState("");
  const [categoryId, setCategoryId] = useState(initialCategoryId);
  const [afterItemId, setAfterItemId] = useState(initialAfterItemId);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const savingRef = useRef(false);

  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    // The height includes the border, which scrollHeight leaves out.
    const border = textarea.offsetHeight - textarea.clientHeight;
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight + border, 36), 360)}px`;
  }, []);

  useEffect(() => {
    resize();
    textareaRef.current?.focus();
  }, [resize]);

  const save = async (trigger: "enter" | "blur") => {
    if (savingRef.current) return;
    if (!markdown.trim()) {
      if (trigger === "blur") onClose();
      return;
    }
    if (!deriveTodoMarkdown(markdown).titleMarkdown) {
      setSaveError("Keep a non-empty title line.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    setRecoveryMessage("");
    try {
      const response = await api.createTodoItem({
        markdown,
        categoryId,
        status: "todo",
        ...(afterItemId ? { afterItemId } : {}),
      });
      onState(response.state);
      if (trigger === "blur") {
        onClose();
        return;
      }
      setMarkdown("");
      // The next to-do goes below the one just added, so a run of Enters keeps their order.
      if (afterItemId) setAfterItemId(response.item?.id ?? afterItemId);
      requestAnimationFrame(() => {
        resize();
        textareaRef.current?.focus();
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    void save("blur");
  };

  const recoverDraft = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(markdown);
      setRecoveryMessage("Draft copied.");
    } catch {
      textareaRef.current?.focus();
      textareaRef.current?.select();
      setRecoveryMessage("Draft selected — copy it manually.");
    }
  };

  return (
    <div
      className="rounded-xl border border-cc-border bg-cc-card p-2"
      onBlurCapture={handleBlur}
      data-testid="todo-composer"
    >
      <textarea
        ref={textareaRef}
        value={markdown}
        disabled={saving}
        rows={1}
        onChange={(event) => {
          setMarkdown(event.target.value);
          setSaveError("");
          setRecoveryMessage("");
          requestAnimationFrame(resize);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void save("enter");
          }
        }}
        aria-label="New to-do"
        placeholder="New to-do"
        className="block max-h-[360px] min-h-9 w-full resize-none overflow-y-auto rounded-lg border border-cc-primary/35 bg-cc-bg px-2.5 py-1.5 text-sm leading-relaxed text-cc-fg outline-none focus:border-cc-primary disabled:opacity-70"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <select
          aria-label="Category"
          value={categoryId}
          onChange={(event) => {
            setCategoryId(event.target.value);
            setAfterItemId(undefined);
          }}
          className={TODO_SELECT_CLASS}
        >
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <span className="truncate text-[11px] text-cc-muted">
          {saving ? "Adding…" : "Enter adds · Shift+Enter for details"}
        </span>
      </div>
      {saveError && (
        <div
          role="alert"
          className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cc-error/30 bg-cc-error/10 px-2.5 py-2 text-xs text-cc-error"
        >
          <span>Could not add it; your draft is still here. {saveError}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void save("enter")}
              className="rounded border border-cc-error/30 px-2 py-1 font-medium hover:bg-cc-error/10"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => void recoverDraft()}
              className="rounded border border-cc-error/30 px-2 py-1 hover:bg-cc-error/10"
            >
              Copy draft
            </button>
          </div>
        </div>
      )}
      {recoveryMessage && (
        <p aria-live="polite" className="mt-1 text-[11px] text-cc-muted">
          {recoveryMessage}
        </p>
      )}
    </div>
  );
}
