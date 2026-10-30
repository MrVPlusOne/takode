import { useRef, useState, type ReactNode } from "react";
import { useOutsidePress } from "../../hooks/useOutsidePress.js";
import { TopicIcon } from "../library/library-icons.js";

/**
 * The breadcrumb's first part: where the conversation on screen lives (Main, All threads, or a
 * topic). Like a VS Code breadcrumb, clicking it lists the places to switch to: Main and All first,
 * then the leader's topics. The open-in-side click (Shift by default) on a topic opens its page in the side column.
 * As in VS Code there is no ▾ (Jiayi's call): the name is the picker, marked by its hover and pressed
 * background, and the room goes to the names.
 */
export function PlaceCrumb({
  place,
  attention,
  list,
}: {
  place: { kind: "main" | "all" } | { kind: "topic"; name: string };
  /** Main's bell (a question or an unread answer in Main), shown beside "Main" when it is on screen. */
  attention?: ReactNode;
  /** The list of places; it calls `close` before navigating. */
  list: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useOutsidePress([listRef, triggerRef], () => setOpen(false), open);
  const label = place.kind === "topic" ? place.name : place.kind === "main" ? "Main" : "All threads";
  return (
    // On a phone the list spans the strip (the nearest positioned box), not just this part.
    <span
      className="relative inline-flex min-w-[5.5rem] max-w-[18rem] shrink-[4] items-center max-sm:static max-sm:min-w-[4rem]"
      data-testid="place-crumb"
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`-mx-1 inline-flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[13px] text-cc-fg hover:bg-cc-hover active:bg-cc-hover ${
          open ? "bg-cc-hover" : ""
        }`}
        title="Switch to Main, All threads or another topic"
        data-testid="place-crumb-button"
      >
        {place.kind === "topic" ? (
          <TopicIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" />
        ) : (
          <MainIcon className="h-3.5 w-3.5 shrink-0 text-cc-muted" />
        )}
        <span className="min-w-0 truncate">{label}</span>
        {attention}
      </button>
      {open && (
        <div
          ref={listRef}
          role="menu"
          className="absolute left-0 top-full z-50 mt-1.5 max-h-[70dvh] w-[28rem] max-sm:left-2 max-sm:right-2 max-sm:w-auto overflow-y-auto rounded-xl border border-cc-border bg-cc-card py-1 shadow-xl"
          data-testid="place-crumb-list"
          onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
        >
          {list(() => setOpen(false))}
        </div>
      )}
    </span>
  );
}

/** A row of the place list for Main or All threads. */
export function PlaceRow({
  label,
  detail,
  selected,
  onClick,
  icon,
  testId,
}: {
  label: ReactNode;
  detail?: ReactNode;
  selected: boolean;
  onClick: () => void;
  icon: ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={`flex w-full items-center gap-3 px-4 py-2 text-left ${selected ? "bg-cc-active" : "hover:bg-cc-hover/40"}`}
      data-testid={testId}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cc-hover text-cc-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[15px] text-cc-fg">{label}</span>
        {detail && <span className="block truncate text-[12.5px] text-cc-muted">{detail}</span>}
      </span>
    </button>
  );
}

export function MainIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path
        d="M2.5 7.2 8 2.8l5.5 4.4v5.8a.7.7 0 0 1-.7.7H9.6V9.6H6.4v4.1H3.2a.7.7 0 0 1-.7-.7z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AllThreadsIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function Chevron() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-cc-muted" fill="none" aria-hidden="true">
      <path d="M4.5 6.5 8 10l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** The ">" between the breadcrumb's parts, drawn as wide as the glyph so the names get the room. */
export function CrumbSeparator() {
  return (
    <svg viewBox="5 2.5 6.5 11" className="h-2.5 w-1.5 shrink-0 text-cc-muted/80" fill="none" aria-hidden="true">
      <path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
