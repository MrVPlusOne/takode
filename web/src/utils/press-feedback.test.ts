// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPressFeedback, MIN_PRESS_MS } from "./press-feedback.js";

// Validates the app-wide press feedback: which controls press, how long a
// quick tap stays visible, and that scrolls and lifts release the press.
let uninstall: () => void;

function control(html: string, size = { width: 44, height: 44 }): HTMLElement {
  document.body.innerHTML = html;
  const element = document.body.querySelector<HTMLElement>("[data-testid=target]")!;
  element.getBoundingClientRect = () => ({ ...size, x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0 }) as DOMRect;
  return element;
}

function pointer(type: string, target: Element, init: PointerEventInit = {}) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, isPrimary: true, pointerId: 1, ...init }));
}

beforeEach(() => {
  vi.useFakeTimers();
  uninstall = installPressFeedback();
});
afterEach(() => {
  uninstall();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("installPressFeedback", () => {
  it("presses a button the moment a finger lands, including on its icon", () => {
    const button = control('<button data-testid="target"><svg><path id="icon" /></svg></button>');
    pointer("pointerdown", document.getElementById("icon")!, { pointerType: "touch" });
    expect(button.dataset.pressed).toBe("down");
    // A 44px button shrinks to the 92% floor.
    expect(button.style.getPropertyValue("--cc-press-scale")).toBe("0.92");
  });

  it("keeps a quick tap visible for the minimum press time, then releases it", () => {
    // A tap shorter than a frame or two would otherwise end before it painted.
    const button = control('<button data-testid="target">Reply</button>');
    pointer("pointerdown", button);
    pointer("pointerup", button);
    expect(button.dataset.pressed).toBe("down");
    vi.advanceTimersByTime(MIN_PRESS_MS);
    // jsdom runs no animations, so the release finishes at once, as under reduced motion.
    expect(button.dataset.pressed).toBeUndefined();
    expect(button.style.getPropertyValue("--cc-press-scale")).toBe("");
  });

  it("releases when the browser takes the touch for a scroll", () => {
    const button = control('<button data-testid="target">Row</button>');
    pointer("pointerdown", button);
    vi.advanceTimersByTime(MIN_PRESS_MS);
    pointer("pointercancel", button);
    expect(button.dataset.pressed).toBeUndefined();
  });

  it("presses wide rows only a few pixels", () => {
    const row = control('<div role="button" data-testid="target">Row</div>', { width: 400, height: 36 });
    pointer("pointerdown", row);
    expect(row.style.getPropertyValue("--cc-press-scale")).toBe("0.98");
  });

  it.each([
    ["disabled buttons", '<button data-testid="target" disabled>Send</button>'],
    ["busy buttons", '<button data-testid="target" aria-busy="true">Send</button>'],
    ["opted-out areas", '<div data-press="none"><button data-testid="target">Send</button></div>'],
    ["plain text", '<p data-testid="target">Text</p>'],
  ])("does not press %s", (_label, html) => {
    const element = control(html);
    pointer("pointerdown", element);
    expect(element.dataset.pressed).toBeUndefined();
  });

  it("does not press tall clickable surfaces", () => {
    const card = control('<div role="button" data-testid="target">Card</div>', { width: 300, height: 200 });
    pointer("pointerdown", card);
    expect(card.dataset.pressed).toBeUndefined();
  });

  it("ignores secondary mouse buttons", () => {
    const button = control('<button data-testid="target">Send</button>');
    pointer("pointerdown", button, { button: 2 });
    expect(button.dataset.pressed).toBeUndefined();
  });
});
