/**
 * Takode's loading and activity indicators. Both inherit their color from the Tailwind text-* class
 * on them or their parent, and follow the cheap-loop rule in index.css: a looping indicator either
 * steps at about 12 frames a second or settles after a few beats, so an idle page draws nothing.
 */

/**
 * Thin arc turning on a faint track while something loads. Size it with w-/h- classes. It turns
 * through Tailwind's animate-spin, which steps 12 times a second (index.css).
 */
export function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`shrink-0 animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
    >
      <circle cx="12" cy="12" r="9" strokeWidth="2.5" opacity="0.2" />
      <circle cx="12" cy="12" r="9" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="15 100" />
    </svg>
  );
}

/**
 * Small solid dot beside a live status ("Purring...", "Compacting conversation..."). While `active`
 * it breathes a soft glow three times after it appears and then keeps a steady glow; otherwise it is
 * a plain dot, as for a stuck or paused turn.
 */
export function ActivityDot({ className = "", active = false }: { className?: string; active?: boolean }) {
  return <span aria-hidden="true" className={`cc-activity-dot ${active ? "is-active" : ""} ${className}`} />;
}
