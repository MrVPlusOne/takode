/**
 * 16x16 `currentColor` icons for injected message chips. The chip sets their
 * size and color, so each icon only draws its shape.
 */

function StrokeIcon({ d }: { d: string | string[] }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {(Array.isArray(d) ? d : [d]).map((path) => (
        <path
          key={path}
          d={path}
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

export function LockIcon() {
  return <StrokeIcon d="M5.5 7V5a2.5 2.5 0 015 0v2M4 7h8v6H4V7z" />;
}

export function WarningIcon() {
  return <StrokeIcon d="M8 2l6 11H2L8 2zM8 6v3M8 12h.01" />;
}

export function RestartIcon() {
  return (
    <StrokeIcon d="M12.5 5.5A5 5 0 003.7 4.3L2.5 5.5M3.5 10.5a5 5 0 008.8 1.2l1.2-1.2M2.5 2.5v3h3M13.5 13.5v-3h-3" />
  );
}

/** An arrow coming down onto a line: a change landing on its branch. */
export function LandingIcon() {
  return <StrokeIcon d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10" />;
}

export function LinkIcon() {
  return (
    <StrokeIcon
      d={[
        "M6.85 4.45l.75-.75a3 3 0 014.25 4.25l-1.7 1.7a3 3 0 01-4.25 0",
        "M9.15 11.55l-.75.75a3 3 0 01-4.25-4.25l1.7-1.7a3 3 0 014.25 0",
        "M6.45 9.55l3.1-3.1",
      ]}
    />
  );
}

export function RouteIcon() {
  return <StrokeIcon d="M3 4.5h5.5c2.5 0 4.5 2 4.5 4.5v2M10.5 8.5L13 11l-2.5 2.5" />;
}

export function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 8.25l2.35 2.35L12 4.95"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="5.75" stroke="currentColor" strokeWidth="1.15" />
    </svg>
  );
}

export function BellIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.5A3.5 3.5 0 004.5 5v2.5c0 .78-.26 1.54-.73 2.16L3 10.66V11.5h10v-.84l-.77-1A3.49 3.49 0 0111.5 7.5V5A3.5 3.5 0 008 1.5zM6.5 13a1.5 1.5 0 003 0h-3z" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M8 2.5v5l3 1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="5.5" />
    </svg>
  );
}

/** A generic system event: a hub with four spokes. */
export function EventIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M8 2.5v4.25M8 9.25v4.25M2.5 8h4.25M9.25 8h4.25" strokeLinecap="round" />
      <circle cx="8" cy="8" r="1.35" />
    </svg>
  );
}
