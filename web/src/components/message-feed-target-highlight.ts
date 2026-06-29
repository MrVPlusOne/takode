export const MESSAGE_TARGET_HIGHLIGHT_CLASS = "message-scroll-highlight";
export const MESSAGE_TARGET_HIGHLIGHT_MS = 1000;

const highlightTimeouts = new WeakMap<HTMLElement, number>();

export function flashMessageFeedTarget(target: HTMLElement): void {
  const existingTimeout = highlightTimeouts.get(target);
  if (existingTimeout) window.clearTimeout(existingTimeout);

  target.classList.remove(MESSAGE_TARGET_HIGHLIGHT_CLASS);
  // Force a style flush so repeated jumps to the same target restart the fade.
  void target.offsetWidth;
  target.classList.add(MESSAGE_TARGET_HIGHLIGHT_CLASS);

  const timeout = window.setTimeout(() => {
    target.classList.remove(MESSAGE_TARGET_HIGHLIGHT_CLASS);
    highlightTimeouts.delete(target);
  }, MESSAGE_TARGET_HIGHLIGHT_MS);
  highlightTimeouts.set(target, timeout);
}
