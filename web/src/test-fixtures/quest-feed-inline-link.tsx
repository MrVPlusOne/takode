// Shared setup for the chat-feed quest link tests. Test files using it must mock "../api.js"
// (getQuestValidated) themselves, since vi.mock only applies in the file that calls it.

import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { api } from "../api.js";
import { QuestInlineLink } from "../components/QuestInlineLink.js";
import { useStore } from "../store.js";
import type { QuestmasterTask } from "../types.js";

export function quest(overrides: Partial<QuestmasterTask> & { questId: string; title: string }): QuestmasterTask {
  const { questId, title, ...rest } = overrides;
  return {
    id: `${questId}-v1`,
    questId,
    version: 1,
    status: "refined",
    title,
    description: "Detailed quest description",
    createdAt: 1,
    ...rest,
  } as QuestmasterTask;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function domRect(x: number, y: number, width: number, height: number): DOMRect {
  return DOMRect.fromRect({ x, y, width, height });
}

export interface GeometryFixture {
  sourceRects: DOMRect[];
  previewRect: DOMRect;
  /** The eye is not rendered (no client rects), as on touch-first devices. */
  eyeHidden?: boolean;
  nextControlRect: DOMRect;
  nearbyControlRects: DOMRect[];
  microRect: DOMRect;
  richRect: DOMRect;
}

/**
 * The mocked layout the tests read. Tests may replace it wholesale or change fields; the installed
 * rect mocks always read the current value.
 */
export let geometryFixture: GeometryFixture;

export function setGeometryFixture(next: GeometryFixture) {
  geometryFixture = next;
}

export function resetGeometryFixture() {
  geometryFixture = {
    sourceRects: [domRect(100, 100, 82, 20)],
    previewRect: domRect(186, 97, 26, 26),
    nextControlRect: domRect(520, 100, 80, 30),
    nearbyControlRects: [],
    microRect: domRect(0, 0, 320, 58),
    richRect: domRect(0, 0, 560, 300),
  };
}

export function installGeometry() {
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function getClientRects(this: Element) {
    const element = this as HTMLElement;
    if (element.dataset.testid === "quest-feed-preview-button") {
      return (geometryFixture.eyeHidden ? [] : [geometryFixture.previewRect]) as unknown as DOMRectList;
    }
    if (element.matches("a.cc-quest-link")) {
      return geometryFixture.sourceRects as unknown as DOMRectList;
    }
    if (element.matches("button[data-next-control]")) {
      return [geometryFixture.nextControlRect] as unknown as DOMRectList;
    }
    if (element.matches("[data-nearby-control]")) {
      return geometryFixture.nearbyControlRects as unknown as DOMRectList;
    }
    return [] as unknown as DOMRectList;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect(
    this: Element,
  ) {
    const element = this as HTMLElement;
    if (element.dataset.testid === "quest-feed-title-preview") return geometryFixture.microRect;
    if (element.dataset.testid === "quest-feed-rich-preview") return geometryFixture.richRect;
    return domRect(0, 0, 0, 0);
  });
}

export function setVisualViewport({
  left,
  top,
  width,
  height,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
}) {
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: {
      offsetLeft: left,
      offsetTop: top,
      width,
      height,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
}

export function setMatchMedia({ coarse = false }: { coarse?: boolean } = {}) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === "(any-pointer: coarse)" ? coarse : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

/** A quest with a known thread labels its icon as the jump; hovering it previews, as the preview tests need. */
export function hoverThreadIcon(questId: string) {
  const icon = screen.getByRole("button", { name: new RegExp(`^Open the ${questId} thread`) });
  fireEvent.pointerEnter(icon, { pointerType: "mouse", clientX: 198, clientY: 110 });
}

export function renderFeedLink(
  questId: string,
  options: { feedbackIndex?: number; title?: string; nextControl?: boolean } = {},
) {
  const cached = options.title ? quest({ questId, title: options.title }) : null;
  if (cached) {
    useStore.setState({
      questDetails: new Map([[questId.toLowerCase(), cached]]),
      questDetailEtags: new Map([[questId.toLowerCase(), `"${questId}-etag"`]]),
    });
    vi.mocked(api.getQuestValidated).mockResolvedValue({ status: "not-modified", etag: `"${questId}-etag"` });
  }
  return render(
    <div data-message-id={`message-${questId}`}>
      <QuestInlineLink questId={questId} feedbackIndex={options.feedbackIndex} surface="chat-feed">
        {options.feedbackIndex === undefined ? questId : `${questId} feedback #${options.feedbackIndex}`}
      </QuestInlineLink>
      {options.nextControl && <button data-next-control="true">Next control</button>}
    </div>,
  );
}

/** Before each test: fake timers, a reset store, a desktop window with mocked layout, synchronous frames. */
export function setUpQuestFeedLinkTest() {
  vi.useFakeTimers();
  useStore.getState().reset();
  useStore.setState({ zoomLevel: 1 });
  vi.mocked(api.getQuestValidated).mockReset();
  setMatchMedia();
  resetGeometryFixture();
  Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  window.location.hash = "#/session/s1";
  installGeometry();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
}

export function tearDownQuestFeedLinkTest() {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
}
