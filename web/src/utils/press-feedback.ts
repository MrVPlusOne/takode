/**
 * App-wide press feedback: every button, tab, menu item or link shrinks the
 * moment a finger or mouse goes down on it and springs back when it lifts, so a
 * press always shows it registered, even when the action behind it waits on a
 * slow connection.
 *
 * One capture-phase `pointerdown` listener on the document marks the pressed
 * control with `data-pressed="down"`, then `"up"` while it springs back; the
 * look lives in `index.css`. Done in script rather than with CSS `:active`
 * because iOS shows `:active` unreliably for touch, and a quick tap would end
 * the press before it painted: the press stays visible for at least
 * `MIN_PRESS_MS`. A scroll that starts on a control cancels its press.
 *
 * - Disabled and busy (`aria-busy="true"`) controls, and anything marked
 *   `data-press="none"`, do not press.
 * - Controls taller than `MAX_PRESS_HEIGHT_PX` (whole cards and panels that
 *   happen to be clickable) do not press: shrinking a large surface looks wrong.
 * - The shrink is sized to the control: small buttons dip about 8%, wide rows
 *   only a few pixels.
 */
export function installPressFeedback(doc: Document = document): () => void {
  let active: { element: HTMLElement; pointerId: number; downAt: number } | null = null;
  const releaseTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const element = pressTarget(event.target);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.height > MAX_PRESS_HEIGHT_PX) return;
    if (active) release(active.element);
    clearTimeout(releaseTimers.get(element));
    element.style.setProperty("--cc-press-scale", String(pressScale(rect.width, rect.height)));
    element.dataset.pressed = "down";
    active = { element, pointerId: event.pointerId, downAt: performance.now() };
  };

  const onPointerEnd = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.pointerId) return;
    const { element, downAt } = active;
    active = null;
    const remaining = MIN_PRESS_MS - (performance.now() - downAt);
    if (remaining <= 0) {
      release(element);
      return;
    }
    releaseTimers.set(
      element,
      setTimeout(() => release(element), remaining),
    );
  };

  doc.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
  doc.addEventListener("pointerup", onPointerEnd, { capture: true, passive: true });
  doc.addEventListener("pointercancel", onPointerEnd, { capture: true, passive: true });
  return () => {
    doc.removeEventListener("pointerdown", onPointerDown, { capture: true });
    doc.removeEventListener("pointerup", onPointerEnd, { capture: true });
    doc.removeEventListener("pointercancel", onPointerEnd, { capture: true });
    if (active) clearPress(active.element);
    active = null;
  };
}

/** Shortest time a press stays visible, so a quick tap still shows. */
export const MIN_PRESS_MS = 90;
/** Taller controls are surfaces rather than buttons and do not press. */
export const MAX_PRESS_HEIGHT_PX = 120;

const PRESSABLE_SELECTOR = 'button, [role="button"], [role="tab"], [role="menuitem"], a[href]';
const RELEASE_ANIMATION = "cc-press-release";

function pressTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>(PRESSABLE_SELECTOR);
  if (!element) return null;
  if (element.closest('[data-press="none"]')) return null;
  if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") return null;
  if (element.getAttribute("aria-busy") === "true") return null;
  return element;
}

/** Shrinks the control by about 8px along its longer side, between 92% and 98.5%. */
function pressScale(width: number, height: number): number {
  const longer = Math.max(width, height, 1);
  return Math.round(Math.min(0.985, Math.max(0.92, 1 - 8 / longer)) * 1000) / 1000;
}

function release(element: HTMLElement) {
  if (element.dataset.pressed !== "down") return;
  element.dataset.pressed = "up";
  // Reduced motion, or a control playing its own animation, has no spring-back to wait for.
  if (!getComputedStyle(element).animationName.includes(RELEASE_ANIMATION)) {
    clearPress(element);
    return;
  }
  const onEnd = (event: AnimationEvent) => {
    if (event.target !== element || event.animationName !== RELEASE_ANIMATION) return;
    element.removeEventListener("animationend", onEnd);
    element.removeEventListener("animationcancel", onEnd);
    if (element.dataset.pressed === "up") clearPress(element);
  };
  element.addEventListener("animationend", onEnd);
  element.addEventListener("animationcancel", onEnd);
}

function clearPress(element: HTMLElement) {
  delete element.dataset.pressed;
  element.style.removeProperty("--cc-press-scale");
}
