// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useStore } from "../../store.js";
import { PlaygroundInlineQuestPreviewSection } from "./PlaygroundInlineQuestPreviewSection.js";

function domRect(x: number, y: number, width: number, height: number): DOMRect {
  return DOMRect.fromRect({ x, y, width, height });
}

function installDeterministicGeometry() {
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function getClientRects(this: Element) {
    const element = this as HTMLElement;
    const fixtureState = element.closest<HTMLElement>("[data-preview-fixture-state]")?.dataset.previewFixtureState;
    if (element.dataset.previewGeometryExclusion) {
      if (fixtureState === "no-fit") {
        const noFitRects = {
          above: domRect(100, 100, 544, 80),
          before: domRect(100, 184, 80, 140),
          after: domRect(370, 184, 274, 140),
          below: domRect(100, 249, 544, 159),
        } as const;
        return [
          noFitRects[element.dataset.previewGeometryExclusion as keyof typeof noFitRects],
        ] as unknown as DOMRectList;
      }
      if (fixtureState === "dense") {
        const denseRects = {
          above: domRect(488.7, 655.3, 171.7, 23.4),
          before: domRect(640.3, 689.5, 77.5, 14.9),
          after: domRect(640.3, 749.4, 77.5, 14.8),
          below: domRect(521.1, 776.8, 658.8, 23.9),
        } as const;
        return [
          denseRects[element.dataset.previewGeometryExclusion as keyof typeof denseRects],
        ] as unknown as DOMRectList;
      }
      return [domRect(0, 0, 1200, 800)] as unknown as DOMRectList;
    }
    if (element.dataset.testid === "quest-feed-preview-button") {
      if (fixtureState === "no-fit") return [domRect(338, 217, 28, 28)] as unknown as DOMRectList;
      if (fixtureState === "dense") return [domRect(645.6, 715.2, 23.4, 23.4)] as unknown as DOMRectList;
      return [domRect(260, 200, 28, 28)] as unknown as DOMRectList;
    }
    if (element.matches("a.cc-quest-link")) {
      if (fixtureState === "no-fit") {
        return [domRect(184, 200, 240, 20), domRect(184, 220, 150, 20)] as unknown as DOMRectList;
      }
      if (fixtureState === "dense") return [domRect(598.9, 716.9, 44.9, 16.2)] as unknown as DOMRectList;
      return [domRect(100, 200, 150, 20)] as unknown as DOMRectList;
    }
    return [] as unknown as DOMRectList;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect(
    this: Element,
  ) {
    const element = this as HTMLElement;
    if (element.dataset.testid === "quest-feed-title-preview") {
      if (document.querySelector("[data-preview-fixture-state='dense']")) return domRect(0, 0, 288, 47.6);
      return domRect(0, 0, 320, 58);
    }
    if (element.dataset.testid === "quest-feed-rich-preview") return domRect(0, 0, 460, 260);
    return domRect(0, 0, 0, 0);
  });
}

function installBrowserCapabilities() {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1200,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
}

describe("PlaygroundInlineQuestPreviewSection", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.setState({ zoomLevel: 1 });
    window.location.hash = "#/playground";
    installBrowserCapabilities();
    installDeterministicGeometry();
  });

  afterEach(() => {
    cleanup();
    document.getElementById("playground-preview-link-colors")?.remove();
    useStore.getState().reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("drives idle, link-title, eye-hover, keyboard, error, and touch states through the real component", async () => {
    render(<PlaygroundInlineQuestPreviewSection />);

    const section = screen.getByRole("heading", { name: "Inline Quest Preview" }).closest("section")!;
    expect(section).toHaveAttribute("id", "overview-inline-quest-preview");
    const controls = within(section).getByRole("group", {
      name: "Inline quest preview fixture state",
    });
    expect(within(controls).getAllByRole("button")).toHaveLength(8);
    expect(within(section).getByText(/cohesive fixed-gap unit/)).toBeInTheDocument();

    let live = await within(section).findByTestId("playground-inline-quest-preview-live");
    expect(live).toHaveAttribute("data-preview-fixture-state", "idle");
    expect(within(live).getByRole("link", { name: "q-9410 feedback #4" })).toBeInTheDocument();
    const idleEye = within(live).getByRole("button", {
      name: /Preview q-9410 feedback #4/,
    });
    expect(idleEye).toHaveAttribute("aria-expanded", "false");
    expect(idleEye.querySelector("svg")).toBeInTheDocument();
    expect(idleEye).not.toHaveTextContent("Preview");
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(
      within(controls).getByRole("button", {
        name: "Show dense-feed link-hover title preview",
      }),
    );
    const denseTitleLayer = await screen.findByTestId("quest-feed-title-preview");
    await waitFor(() => {
      expect(denseTitleLayer).not.toHaveAttribute("data-placement", "no-fit");
      expect(denseTitleLayer).toHaveStyle({ visibility: "visible" });
    });
    expect(denseTitleLayer).toHaveTextContent("Slide compact link details around dense feed controls");

    fireEvent.click(
      within(controls).getByRole("button", {
        name: "Show link-focus title preview",
      }),
    );
    const titleLayer = await screen.findByTestId("quest-feed-title-preview");
    expect(titleLayer).toHaveTextContent("Keep link focus limited to the title-only preview");
    await waitFor(() =>
      expect(within(titleLayer).getByTestId("quest-feed-title-preview-status")).toHaveTextContent("Refined"),
    );
    expect(titleLayer).toHaveClass("pointer-events-none");
    expect(titleLayer).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(
      within(controls).getByRole("button", {
        name: "Show wrapped no-fit state",
      }),
    );
    const noFitLayer = await screen.findByTestId("quest-feed-title-preview");
    await waitFor(() => {
      expect(noFitLayer).toHaveAttribute("data-placement", "no-fit");
      expect(noFitLayer).toHaveStyle({ visibility: "hidden" });
    });
    live = within(section).getByTestId("playground-inline-quest-preview-live");
    expect(within(live).getByRole("link")).toHaveTextContent("deliberately long wrapped exact-target label");
    expect(within(live).getByRole("button", { name: /Preview q-9412 feedback #4/ })).toBeEnabled();
    expect(within(live).getByRole("status")).toHaveTextContent("optional title layer is omitted");

    const richControl = within(controls).getByRole("button", {
      name: "Show fine-pointer eye-hover details",
    });
    richControl.focus();
    fireEvent.click(richControl);
    let dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog).toHaveAttribute("data-surface", "popover"));
    expect(dialog).toHaveTextContent("Reveal rich quest context from the integrated eye");
    expect(within(dialog).getByTestId("quest-hover-status-row")).toHaveTextContent("Completed");
    expect(within(dialog).getByTestId("quest-hover-tldr")).toHaveTextContent(
      "A deterministic Playground fixture for the accepted chat-feed inline quest preview contract.",
    );
    expect(within(dialog).getByTestId("quest-hover-progress-tldr")).toHaveTextContent("Final Debrief");
    expect(within(dialog).getByTestId("quest-hover-journey")).toHaveTextContent("Completed Journey");
    expect(within(dialog).getByRole("link", { name: "Open feedback #4" })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open quest" })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open Thread" })).toHaveAttribute(
      "href",
      "#/session/playground-inline-preview-leader?thread=q-9413",
    );
    live = within(section).getByTestId("playground-inline-quest-preview-live");
    expect(within(live).getByRole("button", { name: /Preview q-9413 feedback #4/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(richControl).toHaveFocus();
    expect(dialog).not.toHaveFocus();

    fireEvent.click(
      within(controls).getByRole("button", {
        name: "Show eye-hover hydration error",
      }),
    );
    dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(within(dialog).getByTestId("quest-feed-rich-error")).toHaveTextContent(
        "Playground fixture: by-ID quest preview request failed.",
      );
    });
    expect(within(dialog).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open feedback #4" })).toBeInTheDocument();

    fireEvent.click(
      within(controls).getByRole("button", {
        name: "Show keyboard-activated eye details",
      }),
    );
    dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(dialog).toHaveAttribute("data-surface", "popover");
      expect(dialog).toHaveFocus();
    });
    live = within(section).getByTestId("playground-inline-quest-preview-live");
    expect(within(live).getByRole("button", { name: /Preview q-9415 feedback #4/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    fireEvent.click(
      within(controls).getByRole("button", {
        name: "Show first-touch modal sheet",
      }),
    );
    dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute("data-surface", "bottom-sheet");
    });
    live = within(section).getByTestId("playground-inline-quest-preview-live");
    expect(within(live).getByRole("button", { name: /Preview q-9416 feedback #4/ })).toHaveClass(
      "cc-feed-quest-preview-trigger-force-coarse",
    );
  });

  it("opens rich details from fine-pointer entry on the icon-only eye", async () => {
    render(<PlaygroundInlineQuestPreviewSection />);
    const live = await screen.findByTestId("playground-inline-quest-preview-live");
    const eye = within(live).getByRole("button", { name: /Preview q-9410 feedback #4/ });

    fireEvent.pointerEnter(eye, { pointerType: "mouse", clientX: 280, clientY: 210 });

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog).toHaveAttribute("data-surface", "popover"));
    expect(dialog).toHaveTextContent("Keep exact chat links independently navigable");
    expect(eye).toHaveAttribute("aria-expanded", "true");
    expect(dialog).not.toHaveFocus();
  });

  it("keeps the authoritative Open Thread fixture available across session-list refreshes", async () => {
    render(<PlaygroundInlineQuestPreviewSection />);
    await screen.findByTestId("playground-inline-quest-preview-live");

    useStore.setState({ sdkSessions: [] });
    expect(
      useStore
        .getState()
        .sessionCompletedBoards.get("playground-inline-preview-leader")
        ?.some((row) => row.questId === "q-9413"),
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Show fine-pointer eye-hover details" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("link", { name: "Open Thread" })).toHaveAttribute(
      "href",
      "#/session/playground-inline-preview-leader?thread=q-9413",
    );
  });

  it("keeps the real parsed Markdown opt-in explicit and preserves the adjacent non-feed legacy boundary", async () => {
    render(<PlaygroundInlineQuestPreviewSection />);
    await screen.findByTestId("playground-inline-quest-preview-live");

    const feed = screen.getByTestId("playground-inline-quest-preview-feed-boundary");
    const legacy = screen.getByTestId("playground-inline-quest-preview-legacy-boundary");
    const feedLink = within(feed).getByRole("link", { name: "q-9410 feedback #4" });
    const feedEye = within(feed).getByRole("button", {
      name: /Preview q-9410 feedback #4/,
    });
    const feedPair = feedLink.closest<HTMLElement>(".cc-feed-quest-link-pair");
    // This constrained real-Markdown fixture is the browser-visible wrapping
    // proof: the pair stays one layout unit without merging either control.
    expect(feedPair).not.toBeNull();
    expect(feedPair).toContainElement(feedLink);
    expect(feedPair).toContainElement(feedEye);
    expect(feedEye.querySelector("svg")).toBeInTheDocument();
    expect(feedEye).not.toHaveTextContent("Preview");
    expect(within(legacy).getByRole("link", { name: "q-9410 feedback #4" })).toBeInTheDocument();
    expect(within(legacy).queryByRole("button", { name: /Preview q-/ })).toBeNull();
  });

  it("shows standard-blue and inline-quiz-orange eyes matching their own adjacent links", async () => {
    // Uses both real Playground producer shapes so visual checks cannot pass
    // with one generic quest-link token applied to every eye.
    const style = document.createElement("style");
    style.id = "playground-preview-link-colors";
    style.textContent = `
      .cc-quest-link { color: rgb(37, 99, 235); }
      .text-cc-primary { color: rgb(234, 88, 12); }
    `;
    document.head.append(style);
    render(<PlaygroundInlineQuestPreviewSection />);
    await screen.findByTestId("playground-inline-quest-preview-live");

    const bluePair = screen.getByTestId("playground-inline-quest-preview-blue-color");
    const orangePair = screen.getByTestId("playground-inline-quest-preview-orange-color");
    const blueLink = within(bluePair).getByRole("link", { name: "q-9410" });
    const blueEye = within(bluePair).getByRole("button", { name: /Preview q-9410/ });
    const orangeLink = within(orangePair).getByRole("link", { name: "q-9410" });
    const orangeEye = within(orangePair).getByRole("button", { name: /Preview q-9410/ });
    const orangeLinkPair = orangeLink.closest<HTMLElement>(".cc-feed-quest-link-pair");

    // The screenshot-shaped constrained quiz host must see one pair child,
    // while the native link and eye remain independently accessible inside it.
    expect(orangeLinkPair).not.toBeNull();
    expect(orangeLinkPair).toContainElement(orangeLink);
    expect(orangeLinkPair).toContainElement(orangeEye);
    expect(blueEye.style.getPropertyValue("--cc-feed-preview-link-color")).toBe(getComputedStyle(blueLink).color);
    expect(orangeEye.style.getPropertyValue("--cc-feed-preview-link-color")).toBe(getComputedStyle(orangeLink).color);
    expect(blueEye.style.getPropertyValue("--cc-feed-preview-link-color")).not.toBe(
      orangeEye.style.getPropertyValue("--cc-feed-preview-link-color"),
    );
  });

  it("reselects a state as a fresh repeatable instance", async () => {
    render(<PlaygroundInlineQuestPreviewSection />);
    const controls = screen.getByRole("group", {
      name: "Inline quest preview fixture state",
    });
    const richControl = within(controls).getByRole("button", {
      name: "Show fine-pointer eye-hover details",
    });

    fireEvent.click(richControl);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await act(async () => fireEvent.click(richControl));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});
