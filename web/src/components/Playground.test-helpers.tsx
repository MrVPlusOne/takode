import { within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, vi } from "vitest";
import { PlaygroundChatViewRecoveryStates } from "./playground/ChatViewRecoveryPlaygroundStates.js";
import { PlaygroundOverviewSections } from "./playground/sections-overview.js";
import { usePlaygroundSeed } from "./playground/usePlaygroundSeed.js";

/** Shared setup for the Playground*.test.tsx files; each file keeps its own vi.mock calls. */
export function installPlaygroundTestEnvironment() {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  // Browser layout APIs are present for annotation markers; measurement cases install their own callback-driven observer.
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
}

export function setMeasuredRailWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: 24,
        width,
        height: 24,
        toJSON: () => ({}),
      }) as DOMRect,
  );
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: { width } } as ResizeObserverEntry], this);
      }
      disconnect() {}
      unobserve() {}
    },
  );
}

export function getPlaygroundSectionByTitle(title: string) {
  const heading = [...document.querySelectorAll<HTMLElement>("section h2")].find((h) => h.textContent === title);
  const section = heading?.closest<HTMLElement>("section");
  if (!section) {
    throw new Error(`Playground section "${title}" was not rendered`);
  }
  return within(section);
}

export function getPlaygroundSection(sectionId: string) {
  const section = document.querySelector<HTMLElement>(`[data-playground-section-id="${sectionId}"]`);
  if (!section) {
    throw new Error(`Playground section ${sectionId} was not rendered`);
  }
  return within(section);
}

export function PlaygroundOverviewOnly() {
  usePlaygroundSeed();
  return <PlaygroundOverviewSections />;
}

export function PlaygroundRecoveryStatesOnly() {
  usePlaygroundSeed();
  return <PlaygroundChatViewRecoveryStates />;
}
