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
    if (element.dataset.testid === "playground-inline-quest-preview-geometry-exclusion") {
      return [domRect(0, 0, 1200, 800)] as unknown as DOMRectList;
    }
    if (element.dataset.testid === "quest-feed-preview-button") {
      return [domRect(260, 200, 82, 28)] as unknown as DOMRectList;
    }
    if (element.matches("a.cc-quest-link")) {
      return [domRect(100, 200, 150, 20)] as unknown as DOMRectList;
    }
    return [] as unknown as DOMRectList;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect(
    this: Element,
  ) {
    const element = this as HTMLElement;
    if (element.dataset.testid === "quest-feed-title-preview") return domRect(0, 0, 320, 58);
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
    useStore.getState().reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("drives idle, title, no-fit, rich, error, and coarse states through the real component", async () => {
    render(<PlaygroundInlineQuestPreviewSection />);

    const section = screen.getByRole("heading", { name: "Inline Quest Preview" }).closest("section")!;
    expect(section).toHaveAttribute("id", "overview-inline-quest-preview");
    const controls = within(section).getByRole("group", {
      name: "Inline quest preview fixture state",
    });
    expect(within(controls).getAllByRole("button")).toHaveLength(6);

    let live = await within(section).findByTestId("playground-inline-quest-preview-live");
    expect(live).toHaveAttribute("data-preview-fixture-state", "idle");
    expect(within(live).getByRole("link", { name: "q-9410 feedback #4" })).toBeInTheDocument();
    expect(within(live).getByRole("button", { name: /Preview q-9410 feedback #4/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(
      within(controls).getByRole("button", {
        name: "Show title micro-preview",
      }),
    );
    const titleLayer = await screen.findByTestId("quest-feed-title-preview");
    expect(titleLayer).toHaveTextContent("Dock a pointer-inert title beside the stable Preview control");
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

    fireEvent.click(within(controls).getByRole("button", { name: "Show rich preview" }));
    let dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog).toHaveAttribute("data-surface", "popover"));
    expect(dialog).toHaveTextContent("Open rich quest context only after explicit Preview activation");
    expect(within(dialog).getByRole("link", { name: "Open feedback #4" })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open quest" })).toBeInTheDocument();

    fireEvent.click(within(controls).getByRole("button", { name: "Show rich error state" }));
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
        name: "Show coarse-pointer sheet",
      }),
    );
    dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute("data-surface", "bottom-sheet");
    });
    live = within(section).getByTestId("playground-inline-quest-preview-live");
    expect(within(live).getByRole("button", { name: /Preview q-9415 feedback #4/ })).toHaveClass(
      "cc-feed-quest-preview-trigger-force-coarse",
    );
  });

  it("keeps the real parsed Markdown opt-in explicit and preserves the adjacent non-feed legacy boundary", async () => {
    render(<PlaygroundInlineQuestPreviewSection />);
    await screen.findByTestId("playground-inline-quest-preview-live");

    const feed = screen.getByTestId("playground-inline-quest-preview-feed-boundary");
    const legacy = screen.getByTestId("playground-inline-quest-preview-legacy-boundary");
    expect(within(feed).getByRole("link", { name: "q-9410 feedback #4" })).toBeInTheDocument();
    expect(within(feed).getByRole("button", { name: /Preview q-9410 feedback #4/ })).toBeInTheDocument();
    expect(within(legacy).getByRole("link", { name: "q-9410 feedback #4" })).toBeInTheDocument();
    expect(within(legacy).queryByRole("button", { name: /Preview q-/ })).toBeNull();
  });

  it("reselects a state as a fresh repeatable instance", async () => {
    render(<PlaygroundInlineQuestPreviewSection />);
    const controls = screen.getByRole("group", {
      name: "Inline quest preview fixture state",
    });
    const richControl = within(controls).getByRole("button", {
      name: "Show rich preview",
    });

    fireEvent.click(richControl);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await act(async () => fireEvent.click(richControl));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});
