/**
 * The focused chat's mark: a thin accent line along the top edge of its (relatively positioned)
 * container, shown only while side panes share the screen with the main view. Subtle on purpose:
 * it tells where typing goes without drawing the eye.
 */
export function ChatFocusMark() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 z-30 h-0.5 bg-cc-primary/70"
      data-testid="chat-focus-mark"
    />
  );
}
