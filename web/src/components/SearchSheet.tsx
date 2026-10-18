/**
 * The look Takode's two message searches share: global search across sessions and a
 * leader's Find. Both are a sheet that rises from the bottom on phones and sits centered
 * on wide screens, with a mode switch and Done on top, one search box, then plain rows:
 * a colored bar, the text the user scans, and one quiet line saying where and when.
 */
import type { CSSProperties, InputHTMLAttributes, KeyboardEvent, ReactNode, Ref } from "react";
import { Fragment } from "react";
import { createPortal } from "react-dom";

/** Rows of chips scroll sideways on narrow phones without showing a scrollbar. */
export const HIDDEN_SCROLLBAR_CLASS = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/** Rows share this layout so a result looks the same in either search. */
export const SEARCH_ROW_CLASS = "flex w-full items-center gap-3 px-4 py-2 text-left";

/** The sheet itself: a bottom sheet on phones, a centered dialog from the `md` breakpoint up. */
export function SearchSheet({
  label,
  header,
  onClose,
  presentation = "fixed",
  layerClassName = "z-50",
  testId,
  backdropTestId,
  dataMode,
  onKeyDown,
  children,
}: {
  label: string;
  /** The mode switch, or a title when there is only one mode. Done follows it. */
  header: ReactNode;
  onClose: () => void;
  /** `inline` renders the sheet in place without a backdrop, for the Playground. */
  presentation?: "fixed" | "inline";
  layerClassName?: string;
  testId?: string;
  backdropTestId?: string;
  dataMode?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  children: ReactNode;
}) {
  const fixed = presentation === "fixed";
  const sheet = (
    <section
      role="dialog"
      aria-modal={fixed ? true : undefined}
      aria-label={label}
      className={`flex flex-col bg-cc-card text-cc-fg shadow-2xl ${
        fixed
          ? "h-[88dvh] rounded-t-2xl border-t border-cc-border md:h-[75vh] md:w-[42rem] md:rounded-2xl md:border"
          : "h-[36rem] w-full max-w-[42rem] rounded-2xl border border-cc-border"
      }`}
      onKeyDown={onKeyDown}
      // Portaled events still bubble to React ancestors, such as the tab bar that opens Find.
      onClick={fixed ? (event) => event.stopPropagation() : undefined}
      onMouseDown={fixed ? (event) => event.stopPropagation() : undefined}
      data-testid={testId}
      data-mode={dataMode}
    >
      {fixed && <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-cc-border md:hidden" />}
      <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-2">
        {header}
        <button type="button" onClick={onClose} className="ml-auto shrink-0 pl-2 text-[14px] text-cc-primary">
          Done
        </button>
      </div>
      {children}
    </section>
  );
  if (!fixed) return sheet;
  // Portaled to the page body, outside the app's zoom scaling, so both searches render
  // at the same size wherever they are opened from.
  return createPortal(
    <div
      className={`fixed inset-0 ${layerClassName} flex flex-col justify-end bg-black/40 md:items-center md:justify-start md:pt-[10vh]`}
      // A press that starts outside the sheet closes it; one that only ends there (selecting
      // text and letting go outside) does not.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      data-testid={backdropTestId}
    >
      {sheet}
    </div>,
    document.body,
  );
}

/** A segmented switch between the sheet's modes. */
export function SearchModeSwitch<Mode extends string>({
  label,
  options,
  value,
  onChange,
  testId,
}: {
  label: string;
  options: ReadonlyArray<{ id: Mode; label: string; title?: string }>;
  value: Mode;
  onChange: (mode: Mode) => void;
  testId?: string;
}) {
  // Five modes fit a phone's width only with tight padding; two keep the roomier look.
  const padding = options.length > 3 ? "px-1.5 md:px-4" : "px-4";
  return (
    <div
      className={`flex min-w-0 overflow-x-auto rounded-lg bg-cc-hover/70 p-0.5 ${HIDDEN_SCROLLBAR_CLASS}`}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          title={option.title}
          onClick={() => onChange(option.id)}
          className={`h-8 shrink-0 whitespace-nowrap rounded-md text-[13px] ${padding} ${
            value === option.id ? "bg-cc-card text-cc-fg shadow-sm" : "text-cc-muted hover:text-cc-fg"
          }`}
          data-testid={testId}
          data-mode={option.id}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** The sheet's one search box. `trailing` sits inside it on the right, e.g. a spinner. */
export function SearchField({
  inputRef,
  trailing,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { inputRef?: Ref<HTMLInputElement>; trailing?: ReactNode }) {
  return (
    <div className="shrink-0 px-4 pb-2">
      <label className="flex h-10 items-center gap-2 rounded-xl bg-cc-hover/70 px-3 text-cc-muted">
        <svg
          viewBox="0 0 16 16"
          className="h-4 w-4 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L14 14" strokeLinecap="round" />
        </svg>
        {/* 16px text keeps iOS from zooming in on focus. */}
        <input
          ref={inputRef}
          className="min-w-0 flex-1 bg-transparent text-[16px] text-cc-fg outline-none placeholder:text-[14px] placeholder:text-cc-muted"
          {...input}
        />
        {trailing}
      </label>
    </div>
  );
}

/** A row's colored bar, then what the user scans, then the quiet line under it. */
export function SearchRowContent({
  barColor,
  barQuiet = false,
  meta,
  metaStyle,
  metaTestId,
  children,
}: {
  barColor: string;
  /** Faded bar for rows that need no attention, like finished work. */
  barQuiet?: boolean;
  meta: ReactNode;
  metaStyle?: CSSProperties;
  metaTestId?: string;
  children: ReactNode;
}) {
  return (
    <>
      <span
        className="w-1 self-stretch shrink-0 rounded-full"
        style={{ backgroundColor: barColor, opacity: barQuiet ? 0.4 : 1 }}
      />
      <span className="flex min-w-0 flex-1 flex-col leading-snug">
        {children}
        <span
          className="mt-0.5 flex min-w-0 items-center overflow-hidden whitespace-pre text-[11.5px] text-cc-muted"
          style={metaStyle}
          data-testid={metaTestId}
        >
          {meta}
        </span>
      </span>
    </>
  );
}

/**
 * Joins a row's details with " · ", skipping empty ones. Only the item at `truncate` (the
 * first by default, usually a long title) gives way when space runs out, so short details
 * such as state and time stay readable.
 */
export function SearchMeta({ items, truncate = 0 }: { items: ReadonlyArray<ReactNode>; truncate?: number }) {
  const shown = items.flatMap((item, index) =>
    item == null || item === false || item === "" ? [] : [{ item, flexible: index === truncate }],
  );
  return (
    <>
      {shown.map(({ item, flexible }, index) => (
        <Fragment key={index}>
          {/* Outside the item: a truncating item would collapse its leading space. */}
          {index > 0 && <span className="shrink-0"> · </span>}
          <span className={flexible ? "min-w-0 truncate" : "shrink-0"}>{item}</span>
        </Fragment>
      ))}
    </>
  );
}
