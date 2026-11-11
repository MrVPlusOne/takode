import type React from "react";

/**
 * Cat paw icons: the answer paw trail, the Approve stamp and the Journey-started stamp.
 * They use `fill="currentColor"` to inherit Tailwind text-* color classes from parent elements.
 */

/** Cat paw print — main pad + 4 toe beans. Used as the assistant message avatar.
 * Coordinates programmatically converted from 552x516 viewBox → 16x16
 * via web/scripts/convert-paw-svg.ts */
export function CatPawAvatar({ className = "w-3 h-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className}>
      <path d="M 8.1 6 C 8.4 6 8.5 6 8.7 6.1 C 8.9 6.1 9.2 6.3 9.3 6.4 C 9.5 6.5 9.6 6.6 9.8 6.9 C 10 7.2 10.2 8 10.5 8.3 C 10.8 8.7 11.1 8.7 11.4 9 C 11.7 9.2 12 9.6 12.1 9.9 C 12.2 10.1 12.3 10.3 12.3 10.5 C 12.3 10.8 12.3 11.1 12.2 11.4 C 12.1 11.7 12 12 11.8 12.2 C 11.7 12.4 11.5 12.6 11.2 12.7 C 10.8 12.8 10.4 13 9.9 12.9 C 9.3 12.9 8.6 12.4 8.1 12.4 C 7.7 12.3 7.4 12.8 7.1 12.9 C 6.7 13 6.4 13 6.1 12.9 C 5.8 12.9 5.4 12.8 5.1 12.6 C 4.8 12.4 4.5 12.1 4.4 11.7 C 4.2 11.4 4.2 10.9 4.2 10.5 C 4.3 10.1 4.4 9.8 4.7 9.5 C 4.9 9.1 5.6 8.8 6 8.4 C 6.3 8 6.5 7.3 6.7 6.9 C 6.9 6.6 7 6.5 7.2 6.4 C 7.4 6.2 7.9 6.1 8.1 6 Z" />
      <ellipse cx="6.2" cy="3.9" rx="1.5" ry="1.9" />
      <ellipse cx="10.2" cy="3.9" rx="1.5" ry="1.9" />
      <ellipse cx="3.7" cy="7.1" rx="1.6" ry="1.9" />
      <ellipse cx="12.8" cy="7.1" rx="1.6" ry="1.9" />
    </svg>
  );
}

/**
 * Downward-facing left paw print — heart-shaped main pad + 4 oval toe beans.
 * Toes fan slightly left for a natural walking splay.
 * Designed to look like a real cat pawprint at small sizes (12–16px).
 */
export function CatPawLeft({
  className = "w-3 h-3",
  style,
  ref,
}: {
  className?: string;
  style?: React.CSSProperties;
  ref?: React.Ref<SVGSVGElement>;
}) {
  return (
    <svg ref={ref} viewBox="0 0 16 16" fill="currentColor" className={className} style={style}>
      <path d="M 8.1 6 C 8.4 6 8.5 6 8.7 6.1 C 8.9 6.1 9.2 6.3 9.3 6.4 C 9.5 6.5 9.6 6.6 9.8 6.9 C 10 7.2 10.2 8 10.5 8.3 C 10.8 8.7 11.1 8.7 11.4 9 C 11.7 9.2 12 9.6 12.1 9.9 C 12.2 10.1 12.3 10.3 12.3 10.5 C 12.3 10.8 12.3 11.1 12.2 11.4 C 12.1 11.7 12 12 11.8 12.2 C 11.7 12.4 11.5 12.6 11.2 12.7 C 10.8 12.8 10.4 13 9.9 12.9 C 9.3 12.9 8.6 12.4 8.1 12.4 C 7.7 12.3 7.4 12.8 7.1 12.9 C 6.7 13 6.4 13 6.1 12.9 C 5.8 12.9 5.4 12.8 5.1 12.6 C 4.8 12.4 4.5 12.1 4.4 11.7 C 4.2 11.4 4.2 10.9 4.2 10.5 C 4.3 10.1 4.4 9.8 4.7 9.5 C 4.9 9.1 5.6 8.8 6 8.4 C 6.3 8 6.5 7.3 6.7 6.9 C 6.9 6.6 7 6.5 7.2 6.4 C 7.4 6.2 7.9 6.1 8.1 6 Z" />
      <ellipse cx="6.2" cy="3.9" rx="1.5" ry="1.9" />
      <ellipse cx="10.2" cy="3.9" rx="1.5" ry="1.9" />
      <ellipse cx="3.7" cy="7.1" rx="1.6" ry="1.9" />
      <ellipse cx="12.8" cy="7.1" rx="1.6" ry="1.9" />
    </svg>
  );
}
