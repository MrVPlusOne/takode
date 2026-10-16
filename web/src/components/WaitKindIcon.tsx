import type { SessionWaitKind } from "../../shared/session-waits.js";

const CLOCK_PATH =
  "M8 1.75a.75.75 0 01.75.75v.88a4.75 4.75 0 11-1.5 0V2.5A.75.75 0 018 1.75zm0 3A3.25 3.25 0 108 11.25 3.25 3.25 0 008 4.75zm.75 1.5v1.44l1.02.61a.75.75 0 11-.77 1.28L7.62 8.8A.75.75 0 017.25 8V6.25a.75.75 0 011.5 0z";

/** Line drawings on a 16-unit grid for every wait kind except the filled timer clock. */
const STROKES: Record<Exclude<SessionWaitKind, "timer">, string[]> = {
  // Two chasing arrows: something is running.
  job: ["M3 8a5 5 0 0 1 8.54-3.54", "M11.7 2.2v2.4H9.3", "M13 8a5 5 0 0 1-8.54 3.54", "M4.3 13.8v-2.4h2.4"],
  // An arrow settling onto a line: the change is landing on its branch.
  landing: ["M8 2.5v7.5", "M4.75 6.75L8 10l3.25-3.25", "M3 13.5h10"],
  // Rows with markers: a place in line.
  queue: ["M3.25 4h.01", "M6.5 4H13", "M3.25 8h.01", "M6.5 8H13", "M3.25 12h.01", "M6.5 12H13"],
  // A person: the user's answer.
  answer: ["M8 2.75a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5z", "M3.25 13.5a4.75 4.75 0 0 1 9.5 0"],
};

const KIND_LABEL: Record<SessionWaitKind, string> = {
  timer: "Timer",
  job: "Background job",
  landing: "Landing run",
  queue: "Queue",
  answer: "Your answer",
};

export function waitKindLabel(kind: SessionWaitKind): string {
  return KIND_LABEL[kind];
}

/**
 * The small icon for one kind of wait, in the current text color. Every surface that
 * shows a wait (sidebar, top bar, feed chip and its list) uses it, so a background
 * job never looks like a timer. `outlined` adds a thin card-colored outline (and a
 * card-colored clock face) for drawing over a portrait's corner.
 */
export function WaitKindIcon({
  kind,
  className,
  outlined = false,
}: {
  kind: SessionWaitKind;
  className?: string;
  outlined?: boolean;
}) {
  if (kind === "timer") {
    return (
      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
        {outlined && (
          <>
            <circle cx="8" cy="8.07" r="4.75" className="fill-cc-card" />
            <path d={CLOCK_PATH} className="fill-none stroke-cc-card" strokeWidth="2.5" strokeLinejoin="round" />
          </>
        )}
        <path d={CLOCK_PATH} />
      </svg>
    );
  }
  const strokes = STROKES[kind];
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {outlined && strokes.map((d) => <path key={`outline-${d}`} d={d} className="stroke-cc-card" strokeWidth="4" />)}
      {strokes.map((d) => (
        <path key={d} d={d} strokeWidth="1.75" />
      ))}
    </svg>
  );
}
