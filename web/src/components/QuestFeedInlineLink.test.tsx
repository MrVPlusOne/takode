// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { QuestmasterTask } from "../types.js";
import { api } from "../api.js";
import { useStore } from "../store.js";
import { QuestFeedInlineLink } from "./QuestFeedInlineLink.js";
import { QuestInlineLink } from "./QuestInlineLink.js";

vi.mock("../api.js", () => ({
  api: {
    getQuestValidated: vi.fn(),
  },
}));

const mockGetQuestValidated = vi.mocked(api.getQuestValidated);

function quest(overrides: Partial<QuestmasterTask> & { questId: string; title: string }): QuestmasterTask {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function domRect(x: number, y: number, width: number, height: number): DOMRect {
  return DOMRect.fromRect({ x, y, width, height });
}

interface GeometryFixture {
  sourceRects: DOMRect[];
  previewRect: DOMRect;
  nextControlRect: DOMRect;
  nearbyControlRects: DOMRect[];
  microRect: DOMRect;
  richRect: DOMRect;
}

let geometryFixture: GeometryFixture;

function resetGeometryFixture() {
  geometryFixture = {
    sourceRects: [domRect(100, 100, 82, 20)],
    previewRect: domRect(186, 97, 26, 26),
    nextControlRect: domRect(520, 100, 80, 30),
    nearbyControlRects: [],
    microRect: domRect(0, 0, 320, 58),
    richRect: domRect(0, 0, 560, 300),
  };
}

function installGeometry() {
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function getClientRects(this: Element) {
    const element = this as HTMLElement;
    if (element.dataset.testid === "quest-feed-preview-button") {
      return [geometryFixture.previewRect] as unknown as DOMRectList;
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

function setVisualViewport({ left, top, width, height }: { left: number; top: number; width: number; height: number }) {
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

function setMatchMedia({ coarse = false }: { coarse?: boolean } = {}) {
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

function renderFeedLink(
  questId: string,
  options: { feedbackIndex?: number; title?: string; nextControl?: boolean } = {},
) {
  const cached = options.title ? quest({ questId, title: options.title }) : null;
  if (cached) {
    useStore.setState({
      questDetails: new Map([[questId.toLowerCase(), cached]]),
      questDetailEtags: new Map([[questId.toLowerCase(), `"${questId}-etag"`]]),
    });
    mockGetQuestValidated.mockResolvedValue({ status: "not-modified", etag: `"${questId}-etag"` });
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

describe("QuestInlineLink chat-feed preview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.getState().reset();
    useStore.setState({ zoomLevel: 1 });
    mockGetQuestValidated.mockReset();
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
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the exact native anchor first and adds one icon-only adjacent Preview control", () => {
    renderFeedLink("q-42", { feedbackIndex: 5, title: "Stable exact target", nextControl: true });

    const link = screen.getByRole("link", { name: "q-42 feedback #5" });
    const preview = screen.getByRole("button", { name: "Preview q-42 feedback #5: Stable exact target" });
    const next = screen.getByRole("button", { name: "Next control" });
    expect(link.getAttribute("href")).toBe("#/session/s1?quest=q-42&feedback=5");
    expect(link.nextElementSibling).toBe(preview);
    expect(preview.nextElementSibling).toBe(next);
    expect(preview).toHaveAttribute("aria-haspopup", "dialog");
    expect(preview).toHaveAttribute("aria-expanded", "false");
    expect(preview).toHaveTextContent("");
    expect(preview.querySelector("svg[aria-hidden='true']")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();
  });

  it("keeps text-link hover title-only after 250 ms and closes it after the bounded leave grace", async () => {
    renderFeedLink("q-43", { title: "Pass-through hover title" });
    const link = screen.getByRole("link", { name: "q-43" });

    fireEvent.pointerEnter(link, { pointerType: "mouse", clientX: 120, clientY: 110 });
    await act(async () => vi.advanceTimersByTime(249));
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("quest-feed-title-preview")).toHaveStyle({ visibility: "visible" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.pointerLeave(link, { pointerType: "mouse" });
    await act(async () => vi.advanceTimersByTime(100));
    expect(screen.getByTestId("quest-feed-title-preview")).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(50));
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();
  });

  it("closes immediately when pointer travel enters another interactive control", async () => {
    renderFeedLink("q-76", { title: "Adjacent control title", nextControl: true });
    const link = screen.getByRole("link", { name: "q-76" });
    const nextControl = screen.getByRole("button", { name: "Next control" });

    fireEvent.pointerEnter(link, { pointerType: "mouse", clientX: 120, clientY: 110 });
    await act(async () => vi.advanceTimersByTime(250));
    expect(screen.getByTestId("quest-feed-title-preview")).toBeVisible();

    fireEvent.pointerLeave(link, { pointerType: "mouse", relatedTarget: nextControl });

    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();
  });

  it("opens rich detail immediately from fine-pointer eye hover without title duplication or focus theft", async () => {
    renderFeedLink("q-53", { title: "Immediate button title" });
    const link = screen.getByRole("link", { name: "q-53" });
    const preview = screen.getByRole("button", { name: /Preview q-53/ });
    link.focus();
    fireEvent.focus(link);
    expect(screen.getByTestId("quest-feed-title-preview")).toBeVisible();

    fireEvent.pointerEnter(preview, { pointerType: "mouse", clientX: 198, clientY: 110 });
    await act(async () => Promise.resolve());

    const dialog = screen.getByRole("dialog", { name: "Immediate button title" });
    expect(dialog).toHaveAttribute("data-open-mode", "hover");
    expect(dialog).toHaveAttribute("aria-modal", "false");
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();
    expect(document.activeElement).toBe(link);
    expect(preview).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps hover-owned rich detail through eye-to-card travel grace, then closes after leaving both", async () => {
    renderFeedLink("q-79", { title: "Hover travel detail" });
    const preview = screen.getByRole("button", { name: /Preview q-79/ });

    fireEvent.pointerEnter(preview, { pointerType: "mouse", clientX: 198, clientY: 110 });
    await act(async () => Promise.resolve());
    const dialog = screen.getByRole("dialog", { name: "Hover travel detail" });

    fireEvent.pointerLeave(preview, { pointerType: "mouse", relatedTarget: null });
    await act(async () => vi.advanceTimersByTime(100));
    expect(screen.getByRole("dialog", { name: "Hover travel detail" })).toBe(dialog);

    fireEvent.pointerEnter(dialog, { pointerType: "mouse" });
    await act(async () => vi.advanceTimersByTime(75));
    expect(screen.getByRole("dialog", { name: "Hover travel detail" })).toBe(dialog);

    fireEvent.pointerLeave(dialog, { pointerType: "mouse", relatedTarget: null });
    await act(async () => vi.advanceTimersByTime(149));
    expect(screen.getByRole("dialog", { name: "Hover travel detail" })).toBe(dialog);
    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(preview).toHaveAttribute("aria-expanded", "false");
  });

  it("restores a surviving text-link focus title after hover-owned rich detail closes", async () => {
    renderFeedLink("q-86", { title: "Retained link focus" });
    const link = screen.getByRole("link", { name: "q-86" });
    const preview = screen.getByRole("button", { name: /Preview q-86/ });
    link.focus();
    fireEvent.focus(link);
    expect(screen.getByTestId("quest-feed-title-preview")).toBeVisible();

    fireEvent.pointerEnter(preview, { pointerType: "mouse", clientX: 198, clientY: 110 });
    await act(async () => Promise.resolve());
    expect(screen.getByRole("dialog", { name: "Retained link focus" })).toHaveAttribute("data-open-mode", "hover");
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();
    expect(document.activeElement).toBe(link);

    fireEvent.pointerLeave(preview, { pointerType: "mouse", relatedTarget: null });
    await act(async () => vi.advanceTimersByTime(150));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("quest-feed-title-preview")).toHaveTextContent("Retained link focus");
    expect(document.activeElement).toBe(link);
  });

  it("dismisses hover-owned rich detail with Escape and does not reopen until the eye is exited", async () => {
    renderFeedLink("q-85", { title: "Escape hover detail" });
    const preview = screen.getByRole("button", { name: /Preview q-85/ });

    fireEvent.pointerEnter(preview, { pointerType: "mouse", clientX: 198, clientY: 110 });
    await act(async () => Promise.resolve());
    expect(screen.getByRole("dialog", { name: "Escape hover detail" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.pointerEnter(preview, { pointerType: "mouse", clientX: 198, clientY: 110 });
    await act(async () => Promise.resolve());
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.pointerLeave(preview, { pointerType: "mouse" });
    await act(async () => vi.advanceTimersByTime(150));
    fireEvent.pointerEnter(preview, { pointerType: "mouse", clientX: 198, clientY: 110 });
    await act(async () => Promise.resolve());
    expect(screen.getByRole("dialog", { name: "Escape hover detail" })).toBeInTheDocument();
  });

  it("promotes an eye-hover preview to explicit ownership without restarting hydration or replacing the dialog", async () => {
    const request = deferred<Awaited<ReturnType<typeof api.getQuestValidated>>>();
    const loaded = quest({ questId: "q-80", title: "Promoted hover detail", tldr: "Loaded once" });
    mockGetQuestValidated.mockReturnValueOnce(request.promise);
    renderFeedLink("q-80");
    const preview = screen.getByRole("button", { name: "Preview q-80" });

    fireEvent.pointerEnter(preview, { pointerType: "mouse", clientX: 198, clientY: 110 });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-open-mode", "hover");
    expect(mockGetQuestValidated).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(preview, { pointerType: "mouse" });
    fireEvent.click(preview, { detail: 1 });
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(dialog).toHaveAttribute("data-open-mode", "explicit");
    expect(mockGetQuestValidated).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(dialog);

    await act(async () => request.resolve({ status: "fresh", data: loaded, etag: '"promoted"' }));
    expect(screen.getByRole("dialog", { name: "Promoted hover detail" })).toBe(dialog);
    expect(dialog).toHaveTextContent("Loaded once");
  });

  it("omits a cached title layer when its by-id revalidation fails", async () => {
    renderFeedLink("q-54", { title: "Stale cached title" });
    const request = deferred<Awaited<ReturnType<typeof api.getQuestValidated>>>();
    mockGetQuestValidated.mockReset();
    mockGetQuestValidated.mockReturnValueOnce(request.promise);
    const link = screen.getByRole("link", { name: "q-54" });

    fireEvent.pointerEnter(link, { pointerType: "mouse", clientX: 120, clientY: 110 });
    await act(async () => vi.advanceTimersByTime(250));
    expect(screen.getByTestId("quest-feed-title-preview")).toBeInTheDocument();
    await act(async () => request.reject(new Error("not found")));
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();
    expect(link).toBeInTheDocument();
  });

  it("shows title for link focus, keeps eye focus closed, and suppresses pointer-origin focus flashes", async () => {
    renderFeedLink("q-44", { title: "Keyboard title" });
    const link = screen.getByRole("link", { name: "q-44" });
    const preview = screen.getByRole("button", { name: /Preview q-44/ });

    fireEvent.focus(link);
    expect(screen.getByTestId("quest-feed-title-preview")).toBeInTheDocument();

    fireEvent.blur(link, { relatedTarget: preview });
    fireEvent.focus(preview);
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.pointerDown(link, { pointerType: "mouse" });
    fireEvent.focus(link);
    await act(async () => vi.runOnlyPendingTimers());
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();
  });

  it("opens rich detail from both Enter and Space only after explicit eye activation", async () => {
    renderFeedLink("q-78", { title: "Keyboard eye detail" });
    const preview = screen.getByRole("button", { name: /Preview q-78/ });

    preview.focus();
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.keyDown(preview, { key: "Enter" });
    fireEvent.click(preview, { detail: 0 });
    fireEvent.keyUp(preview, { key: "Enter" });
    await act(async () => Promise.resolve());
    let dialog = screen.getByRole("dialog", { name: "Keyboard eye detail" });
    expect(dialog).toHaveAttribute("data-open-mode", "explicit");
    expect(document.activeElement).toBe(dialog);

    fireEvent.keyDown(dialog, { key: "Escape" });
    await act(async () => vi.runOnlyPendingTimers());
    expect(document.activeElement).toBe(preview);
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();

    fireEvent.keyDown(preview, { key: " " });
    fireEvent.keyUp(preview, { key: " " });
    fireEvent.click(preview, { detail: 0 });
    await act(async () => Promise.resolve());
    dialog = screen.getByRole("dialog", { name: "Keyboard eye detail" });
    expect(dialog).toHaveAttribute("data-open-mode", "explicit");
    expect(document.activeElement).toBe(dialog);
  });

  it("restarts the full 250 ms source dwell after leaving during arming", async () => {
    renderFeedLink("q-72", { title: "Fresh dwell title" });
    const link = screen.getByRole("link", { name: "q-72" });

    fireEvent.pointerEnter(link, { pointerType: "mouse", clientX: 120, clientY: 110 });
    await act(async () => vi.advanceTimersByTime(249));
    fireEvent.pointerLeave(link, { pointerType: "mouse" });
    await act(async () => vi.advanceTimersByTime(50));
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();

    fireEvent.pointerEnter(link, { pointerType: "mouse", clientX: 121, clientY: 110 });
    await act(async () => vi.advanceTimersByTime(249));
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("quest-feed-title-preview")).toBeVisible();
  });

  it("rescales wrapped-link placement from the latest fine-pointer fragment", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
    geometryFixture = {
      ...geometryFixture,
      sourceRects: [domRect(20, 20, 70, 18), domRect(20, 70, 70, 18)],
      previewRect: domRect(240, 300, 70, 28),
      microRect: domRect(0, 0, 180, 54),
    };
    renderFeedLink("q-77", { title: "Wrapped pointer title" });
    const link = screen.getByRole("link", { name: "q-77" });

    fireEvent.pointerEnter(link, { pointerType: "mouse", clientX: 55, clientY: 29 });
    await act(async () => vi.advanceTimersByTime(250));
    let title = screen.getByTestId("quest-feed-title-preview");
    expect(title).toHaveAttribute("data-placement", "block-start");
    expect(title).toHaveStyle({ left: "130px", top: "240px" });

    fireEvent.pointerMove(link, { pointerType: "mouse", clientX: 55, clientY: 79 });
    title = screen.getByTestId("quest-feed-title-preview");
    expect(title).toHaveAttribute("data-placement", "inline-start");
    expect(title).toHaveStyle({ left: "54px", top: "274px" });
  });

  it("suppresses Escape re-open until pointer and focus leave", async () => {
    renderFeedLink("q-45", { title: "Escape title" });
    const link = screen.getByRole("link", { name: "q-45" });

    fireEvent.pointerEnter(link, { pointerType: "mouse", clientX: 120, clientY: 110 });
    await act(async () => vi.advanceTimersByTime(250));
    expect(screen.getByTestId("quest-feed-title-preview")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();

    fireEvent.pointerEnter(link, { pointerType: "mouse", clientX: 121, clientY: 110 });
    await act(async () => vi.advanceTimersByTime(300));
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();

    fireEvent.pointerLeave(link, { pointerType: "mouse" });
    await act(async () => vi.advanceTimersByTime(150));
    fireEvent.pointerEnter(link, { pointerType: "mouse", clientX: 122, clientY: 110 });
    await act(async () => vi.advanceTimersByTime(250));
    expect(screen.getByTestId("quest-feed-title-preview")).toBeInTheDocument();
  });

  it("keeps only one transient micro-preview active across feed links", async () => {
    useStore.setState({
      questDetails: new Map([
        ["q-46", quest({ questId: "q-46", title: "First title" })],
        ["q-47", quest({ questId: "q-47", title: "Second title" })],
      ]),
    });
    mockGetQuestValidated.mockImplementation(async (id) => ({
      status: "fresh",
      data: useStore.getState().questDetails.get(id)!,
      etag: `"${id}"`,
    }));
    render(
      <div data-message-id="two-links">
        <QuestInlineLink questId="q-46" surface="chat-feed" />
        <QuestInlineLink questId="q-47" surface="chat-feed" />
      </div>,
    );

    fireEvent.focus(screen.getByRole("link", { name: "q-46" }));
    expect(screen.getByText("First title")).toBeInTheDocument();
    fireEvent.focus(screen.getByRole("link", { name: "q-47" }));
    expect(screen.queryByText("First title")).toBeNull();
    expect(screen.getByText("Second title")).toBeInTheDocument();
  });

  it("lets a second eye hover replace hover-owned rich detail across feed links", async () => {
    const first = quest({ questId: "q-81", title: "First hover detail" });
    const second = quest({ questId: "q-82", title: "Second hover detail" });
    useStore.setState({
      questDetails: new Map([
        ["q-81", first],
        ["q-82", second],
      ]),
    });
    mockGetQuestValidated.mockImplementation(async (questId) => ({
      status: "fresh",
      data: questId === "q-81" ? first : second,
      etag: `"${questId}"`,
    }));
    render(
      <div data-message-id="two-eye-links">
        <QuestInlineLink questId="q-81" surface="chat-feed" />
        <QuestInlineLink questId="q-82" surface="chat-feed" />
      </div>,
    );
    const [firstEye, secondEye] = screen.getAllByRole("button", { name: /Preview q-8/ });

    fireEvent.pointerEnter(firstEye, { pointerType: "mouse", clientX: 198, clientY: 110 });
    await act(async () => Promise.resolve());
    expect(screen.getByRole("dialog", { name: "First hover detail" })).toBeInTheDocument();

    fireEvent.pointerEnter(secondEye, { pointerType: "mouse", clientX: 198, clientY: 110 });
    await act(async () => Promise.resolve());
    expect(screen.queryByRole("dialog", { name: "First hover detail" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Second hover detail" })).toHaveAttribute("data-open-mode", "hover");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("opens a labelled explicit loading dialog on eye activation, then reuses 304 cached detail", async () => {
    const cached = quest({ questId: "q-48", title: "Cached detail", tldr: "Validated summary" });
    useStore.setState({
      questDetails: new Map([["q-48", cached]]),
      questDetailEtags: new Map([["q-48", '"detail-v1"']]),
    });
    const request = deferred<Awaited<ReturnType<typeof api.getQuestValidated>>>();
    mockGetQuestValidated.mockReturnValueOnce(request.promise);
    renderFeedLink("q-48", { nextControl: true });
    const preview = screen.getByRole("button", { name: /Preview q-48/ });

    fireEvent.click(preview);
    const dialog = screen.getByRole("dialog", { name: "Cached detail" });
    expect(dialog).toHaveAttribute("aria-modal", "false");
    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(within(dialog).getByRole("status")).toHaveTextContent("Refreshing…");
    expect(preview).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByRole("link", { name: "Open quest" })).toHaveAttribute("href", "#/session/s1?quest=q-48");
    expect(document.activeElement).toBe(dialog);

    await act(async () => request.resolve({ status: "not-modified", etag: '"detail-v1"' }));
    expect(dialog).toHaveAttribute("aria-busy", "false");
    expect(within(dialog).getByTestId("quest-feed-rich-ready-announcement")).toHaveTextContent("Quest preview ready.");
    expect(within(dialog).getByTestId("quest-feed-rich-status")).toHaveTextContent("Refined");
    expect(dialog).toHaveTextContent("Validated summary");
    expect(mockGetQuestValidated).toHaveBeenCalledWith("q-48", '"detail-v1"');
  });

  it("keeps exact feedback primary, parent secondary, and tombstones on the same exact route", async () => {
    const cached = quest({
      questId: "q-49",
      title: "Tombstone detail",
      feedback: [
        { author: "agent", text: "kept", ts: 1 },
        { author: "human", text: "", ts: 2, deletedAt: 3 },
      ],
    });
    useStore.setState({
      questDetails: new Map([["q-49", cached]]),
      questDetailEtags: new Map([["q-49", '"detail-v1"']]),
    });
    mockGetQuestValidated.mockResolvedValueOnce({ status: "not-modified", etag: '"detail-v1"' });
    renderFeedLink("q-49", { feedbackIndex: 1 });

    fireEvent.click(screen.getByRole("button", { name: /Preview q-49 feedback #1/ }));
    await act(async () => Promise.resolve());
    const dialog = screen.getByRole("dialog");
    const actions = within(dialog).getAllByRole("link");
    expect(actions.map((action) => action.textContent)).toEqual(["Open feedback #1", "Open quest"]);
    expect(actions[0]).toHaveAttribute("href", "#/session/s1?quest=q-49&feedback=1");
    expect(actions[1]).toHaveAttribute("href", "#/session/s1?quest=q-49");
    expect(within(dialog).getByTestId("quest-feed-feedback-unavailable")).toHaveTextContent("stable index");
  });

  it("retains direct actions on error, retries by id, and rejects a stale route completion", async () => {
    const first = deferred<Awaited<ReturnType<typeof api.getQuestValidated>>>();
    const fresh = quest({ questId: "q-50", title: "Recovered title", tldr: "Recovered detail" });
    mockGetQuestValidated.mockReturnValueOnce(first.promise).mockResolvedValueOnce({
      status: "fresh",
      data: fresh,
      etag: '"fresh"',
    });
    renderFeedLink("q-50");
    fireEvent.click(screen.getByRole("button", { name: "Preview q-50" }));
    await act(async () => first.reject(new Error("offline")));

    let dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("offline");
    expect(dialog).toHaveAttribute("aria-busy", "false");
    expect(within(dialog).getByRole("link", { name: "Open quest" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    await act(async () => Promise.resolve());
    dialog = screen.getByRole("dialog", { name: "Recovered title" });
    expect(dialog).toHaveTextContent("Recovered detail");

    const stale = deferred<Awaited<ReturnType<typeof api.getQuestValidated>>>();
    mockGetQuestValidated.mockReturnValueOnce(stale.promise);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await act(async () => vi.runOnlyPendingTimers());
    fireEvent.click(screen.getByRole("button", { name: /Preview q-50/ }));
    await act(async () => {
      window.location.hash = "#/session/s1?thread=q-2";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => stale.resolve({ status: "fresh", data: fresh, etag: '"later"' }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uses per-event pointer type on mixed-input devices and preserves delayed touch-focus suppression", async () => {
    setMatchMedia({ coarse: true });
    const cached = quest({ questId: "q-51", title: "Touch detail" });
    useStore.setState({ questDetails: new Map([["q-51", cached]]) });
    mockGetQuestValidated.mockResolvedValue({ status: "fresh", data: cached, etag: '"touch"' });
    renderFeedLink("q-51");
    const link = screen.getByRole("link", { name: "q-51" });
    const preview = screen.getByRole("button", { name: /Preview q-51/ });

    fireEvent.pointerEnter(link, { pointerType: "mouse", clientX: 120, clientY: 110 });
    await act(async () => vi.advanceTimersByTime(250));
    expect(screen.getByTestId("quest-feed-title-preview")).toBeVisible();
    fireEvent.pointerLeave(link, { pointerType: "mouse" });
    await act(async () => vi.advanceTimersByTime(150));

    fireEvent.pointerEnter(preview, { pointerType: "mouse", clientX: 198, clientY: 110 });
    await act(async () => Promise.resolve());
    let dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-open-mode", "hover");
    expect(dialog).toHaveAttribute("aria-modal", "false");
    expect(dialog).not.toHaveAttribute("data-surface", "bottom-sheet");

    fireEvent.pointerDown(preview, { pointerType: "touch" });
    await act(async () => vi.advanceTimersByTime(500));
    fireEvent.focus(preview);
    await act(async () => vi.advanceTimersByTime(500));
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();

    fireEvent.click(preview, { detail: 1 });
    await act(async () => Promise.resolve());
    dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-open-mode", "explicit");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("data-surface", "bottom-sheet");
    const backdrop = screen.getByTestId("quest-feed-rich-backdrop");
    expect(backdrop).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("button", { name: "Close quest preview" })).toBeNull();
  });

  it("includes the dialog container in desktop forward and reverse focus order", async () => {
    renderFeedLink("q-52", { title: "Keyboard detail", nextControl: true });
    const preview = screen.getByRole("button", { name: /Preview q-52/ });
    fireEvent.click(preview, { detail: 0 });
    await act(async () => Promise.resolve());
    let dialog = screen.getByRole("dialog");
    const primary = within(dialog).getByRole("link", { name: "Open quest" });

    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(primary);
    fireEvent.keyDown(primary, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(preview);
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();

    fireEvent.click(preview, { detail: 0 });
    await act(async () => Promise.resolve());
    dialog = screen.getByRole("dialog");
    const close = within(dialog).getByRole("button", { name: "Close" });
    close.focus();
    fireEvent.keyDown(close, { key: "Tab" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next control" }));
  });

  it("uses keyboard dismissal modality after a touch-opened rich preview", async () => {
    setMatchMedia({ coarse: true });
    renderFeedLink("q-73", { title: "Keyboard dismissal title" });
    const preview = screen.getByRole("button", { name: /Preview q-73/ });

    fireEvent.pointerDown(preview, { pointerType: "touch" });
    fireEvent.click(preview, { detail: 1 });
    await act(async () => Promise.resolve());
    const dialog = screen.getByRole("dialog");

    fireEvent.keyDown(dialog, { key: "Escape" });
    await act(async () => vi.runOnlyPendingTimers());

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(preview);
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();
  });

  it("keeps an explicitly opened rich preview while another link is merely hovered", async () => {
    const first = quest({ questId: "q-55", title: "Pinned rich preview", tldr: "Pinned details" });
    const second = quest({ questId: "q-56", title: "Second hover title" });
    useStore.setState({
      questDetails: new Map([
        ["q-55", first],
        ["q-56", second],
      ]),
    });
    mockGetQuestValidated.mockImplementation(async (questId) => ({
      status: "fresh",
      data: questId === "q-55" ? first : second,
      etag: `"${questId}"`,
    }));
    render(
      <div data-message-id="rich-owner">
        <QuestInlineLink questId="q-55" surface="chat-feed" />
        <QuestInlineLink questId="q-56" surface="chat-feed" />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Preview q-55/ }), { detail: 0 });
    await act(async () => Promise.resolve());
    const pinnedDialog = screen.getByRole("dialog", { name: "Pinned rich preview" });

    fireEvent.pointerEnter(screen.getByRole("link", { name: "q-56" }), {
      pointerType: "mouse",
      clientX: 120,
      clientY: 110,
    });
    await act(async () => vi.advanceTimersByTime(300));

    expect(screen.getByRole("dialog", { name: "Pinned rich preview" })).toBe(pinnedDialog);
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();
  });

  it("suppresses restored-focus title flash when pointer-closing a keyboard-opened rich preview", async () => {
    renderFeedLink("q-57", { title: "No restored flash" });
    const preview = screen.getByRole("button", { name: /Preview q-57/ });
    fireEvent.click(preview, { detail: 0 });
    await act(async () => Promise.resolve());

    const close = within(screen.getByRole("dialog")).getByRole("button", { name: "Close" });
    fireEvent.pointerDown(close, { pointerType: "mouse" });
    fireEvent.click(close, { detail: 1 });
    await act(async () => vi.runOnlyPendingTimers());

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(preview);
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();
  });

  it("keeps a delayed first touch on the exact text link native to that exact target", async () => {
    const openQuestOverlay = vi.fn();
    useStore.setState({ openQuestOverlay });
    renderFeedLink("q-58", { feedbackIndex: 3, title: "Exact touch target" });
    const link = screen.getByRole("link", { name: "q-58 feedback #3" });

    fireEvent.pointerDown(link, { pointerType: "touch" });
    await act(async () => vi.advanceTimersByTime(500));
    fireEvent.focus(link);
    await act(async () => vi.advanceTimersByTime(500));
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();

    fireEvent.click(link, { button: 0, detail: 1 });
    expect(openQuestOverlay).toHaveBeenCalledWith("q-58", undefined, 3);
    expect(window.location.hash).toBe("#/session/s1?quest=q-58&feedback=3");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("suppresses only the title shell when no legal rendered placement exists", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 300 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 100 });
    geometryFixture = {
      ...geometryFixture,
      sourceRects: [domRect(100, 40, 82, 20)],
      previewRect: domRect(188, 36, 72, 28),
      microRect: domRect(0, 0, 284, 58),
    };
    renderFeedLink("q-59", { title: "No-fit title" });
    const link = screen.getByRole("link", { name: "q-59" });
    const preview = screen.getByRole("button", { name: /Preview q-59/ });

    fireEvent.focus(link);

    const title = screen.getByTestId("quest-feed-title-preview");
    expect(title).toHaveAttribute("data-placement", "no-fit");
    expect(title).toHaveStyle({ visibility: "hidden" });
    expect(link).toBeInTheDocument();
    expect(preview).toBeInTheDocument();
  });

  it("uses final rendered dimensions and visual-viewport offsets at 150 percent zoom", async () => {
    useStore.setState({ zoomLevel: 1.5 });
    setVisualViewport({ left: 25, top: 15, width: 800, height: 650 });
    geometryFixture = {
      ...geometryFixture,
      sourceRects: [domRect(249, 100, 82, 20)],
      previewRect: domRect(337, 96, 72, 28),
      microRect: domRect(0, 0, 480, 87),
    };
    renderFeedLink("q-60", { title: "Rendered zoom title" });

    fireEvent.pointerEnter(screen.getByRole("link", { name: "q-60" }), {
      pointerType: "mouse",
      clientX: 280,
      clientY: 110,
    });
    await act(async () => vi.advanceTimersByTime(250));

    const title = screen.getByTestId("quest-feed-title-preview");
    const left = Number.parseFloat(title.style.left);
    const top = Number.parseFloat(title.style.top);
    const renderedWidth = Number.parseFloat(title.style.width) * 1.5;
    expect(title).toHaveStyle({ visibility: "visible", transform: "scale(1.5)" });
    expect(left).toBeGreaterThanOrEqual(25 + 8);
    expect(left + renderedWidth).toBeLessThanOrEqual(25 + 800 - 8);
    expect(top).toBeGreaterThanOrEqual(15 + 8);
  });

  it("switches a desktop no-fit popover to a right-edge-docked nonmodal side sheet", async () => {
    geometryFixture = {
      ...geometryFixture,
      richRect: domRect(0, 0, 560, 700),
    };
    renderFeedLink("q-66", { title: "Right docked sheet" });

    fireEvent.click(screen.getByRole("button", { name: /Preview q-66/ }), { detail: 0 });
    await act(async () => Promise.resolve());

    const dialog = screen.getByRole("dialog", { name: "Right docked sheet" });
    expect(dialog).toHaveAttribute("aria-modal", "false");
    expect(dialog).toHaveAttribute("data-surface", "side-sheet");
    expect(dialog).toHaveAttribute("data-edge", "right");
    const renderedLeft = Number.parseFloat(dialog.style.left);
    const renderedWidth = Number.parseFloat(dialog.style.width);
    expect(renderedLeft + renderedWidth).toBe(1200);
    expect(renderedLeft).toBeGreaterThan(geometryFixture.previewRect.right);
  });

  it("protects visible controls outside the source's local feed container", async () => {
    const cached = quest({ questId: "q-69", title: "Viewport-wide exclusions" });
    useStore.setState({ questDetails: new Map([["q-69", cached]]) });
    mockGetQuestValidated.mockResolvedValue({ status: "fresh", data: cached, etag: '"q-69"' });
    geometryFixture = {
      ...geometryFixture,
      nearbyControlRects: [domRect(180, 128, 680, 360)],
    };
    render(
      <>
        <div className="message-feed-scroll-surface" data-message-id="local-feed-only">
          <QuestInlineLink questId="q-69" surface="chat-feed" />
        </div>
        <details open>
          <summary data-nearby-control="outside-local-feed">Adjacent reasoning toggle</summary>
        </details>
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Preview q-69/ }), { detail: 0 });
    await act(async () => Promise.resolve());

    const dialog = screen.getByRole("dialog", { name: "Viewport-wide exclusions" });
    expect(dialog).toHaveAttribute("data-surface", "side-sheet");
    const layer = domRect(
      Number.parseFloat(dialog.style.left),
      Number.parseFloat(dialog.style.top),
      Number.parseFloat(dialog.style.width),
      Math.min(geometryFixture.richRect.height, Number.parseFloat(dialog.style.maxHeight)),
    );
    const control = geometryFixture.nearbyControlRects[0];
    expect(
      layer.left < control.right &&
        layer.right > control.left &&
        layer.top < control.bottom &&
        layer.bottom > control.top,
    ).toBe(false);
  });

  it("ignores inert and truly hidden untabbable phantom controls when choosing rich placement", async () => {
    const cached = quest({ questId: "q-83", title: "Filtered phantom controls" });
    useStore.setState({ questDetails: new Map([["q-83", cached]]) });
    mockGetQuestValidated.mockResolvedValue({ status: "fresh", data: cached, etag: '"q-83"' });
    geometryFixture = {
      ...geometryFixture,
      nearbyControlRects: [domRect(0, 0, 1200, 800)],
    };
    render(
      <>
        <div className="message-feed-scroll-surface" data-message-id="phantom-control-feed">
          <QuestInlineLink questId="q-83" surface="chat-feed" />
        </div>
        <button type="button" inert tabIndex={-1} data-nearby-control="inert">
          Inert overlay
        </button>
        <button
          type="button"
          tabIndex={-1}
          data-nearby-control="pointer-inert"
          style={{ opacity: 0, pointerEvents: "none" }}
        >
          Pointer-inert overlay
        </button>
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Preview q-83/ }), { detail: 0 });
    await act(async () => Promise.resolve());

    const dialog = screen.getByRole("dialog", { name: "Filtered phantom controls" });
    expect(dialog).toHaveAttribute("data-surface", "popover");
    expect(dialog).toHaveAttribute("aria-modal", "false");
  });

  it("keeps visible focusable aria-disabled and pointer-inert controls as placement exclusions", async () => {
    const cached = quest({ questId: "q-87", title: "Focusable controls stay protected" });
    useStore.setState({ questDetails: new Map([["q-87", cached]]) });
    mockGetQuestValidated.mockResolvedValue({ status: "fresh", data: cached, etag: '"q-87"' });
    geometryFixture = {
      ...geometryFixture,
      nearbyControlRects: [domRect(0, 0, 1200, 800)],
    };
    render(
      <>
        <div className="message-feed-scroll-surface" data-message-id="focusable-control-feed">
          <QuestInlineLink questId="q-87" surface="chat-feed" />
        </div>
        <button type="button" aria-disabled="true" data-nearby-control="aria-disabled">
          Focusable disabled pagination
        </button>
        <button type="button" data-nearby-control="pointer-inert" style={{ pointerEvents: "none" }}>
          Keyboard-focusable pointer-inert control
        </button>
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Preview q-87/ }), { detail: 0 });
    await act(async () => Promise.resolve());

    const dialog = screen.getByRole("dialog", { name: "Focusable controls stay protected" });
    expect(dialog).toHaveAttribute("data-surface", "bottom-sheet");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("uses a top-edge-docked desktop sheet when neither inline side can fit", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    geometryFixture = {
      ...geometryFixture,
      sourceRects: [domRect(180, 400, 420, 28)],
      previewRect: domRect(610, 396, 70, 36),
      richRect: domRect(0, 0, 560, 500),
    };
    renderFeedLink("q-67", { title: "Top docked sheet" });

    fireEvent.click(screen.getByRole("button", { name: /Preview q-67/ }), { detail: 0 });
    await act(async () => Promise.resolve());

    const dialog = screen.getByRole("dialog", { name: "Top docked sheet" });
    expect(dialog).toHaveAttribute("data-surface", "side-sheet");
    expect(dialog).toHaveAttribute("data-edge", "top");
    expect(Number.parseFloat(dialog.style.top)).toBe(0);
    const renderedBottom = Number.parseFloat(dialog.style.top) + Number.parseFloat(dialog.style.maxHeight);
    expect(renderedBottom).toBeLessThan(geometryFixture.sourceRects[0].top);
  });

  it("keeps a high-zoom bottom sheet within the rendered visual viewport", async () => {
    useStore.setState({ zoomLevel: 4 });
    setMatchMedia({ coarse: true });
    setVisualViewport({ left: 25, top: 15, width: 430, height: 500 });
    geometryFixture = {
      ...geometryFixture,
      sourceRects: [domRect(120, 100, 82, 20)],
      previewRect: domRect(210, 92, 88, 44),
      richRect: domRect(0, 0, 960, 420),
    };
    renderFeedLink("q-68", { title: "High zoom sheet" });

    const preview = screen.getByRole("button", { name: /Preview q-68/ });
    fireEvent.pointerDown(preview, { pointerType: "touch" });
    fireEvent.click(preview, { detail: 1 });
    await act(async () => Promise.resolve());

    const dialog = screen.getByRole("dialog", { name: "High zoom sheet" });
    expect(dialog).toHaveAttribute("data-surface", "bottom-sheet");
    expect(dialog).toHaveStyle({ transform: "scale(4)" });
    const left = Number.parseFloat(dialog.style.left);
    const top = Number.parseFloat(dialog.style.top);
    const renderedWidth = Number.parseFloat(dialog.style.width) * 4;
    const renderedMaxHeight = Number.parseFloat(dialog.style.maxHeight) * 4;
    expect(left).toBeGreaterThanOrEqual(25 + 12);
    expect(left + renderedWidth).toBeLessThanOrEqual(25 + 430 - 12);
    expect(top).toBeGreaterThanOrEqual(15 + 12);
    expect(renderedMaxHeight).toBeLessThanOrEqual(500 - 24);
  });

  it("closes hover-owned rich detail instead of modalizing when no nonblocking placement exists", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
    geometryFixture = {
      ...geometryFixture,
      sourceRects: [domRect(100, 110, 600, 280)],
      previewRect: domRect(710, 235, 26, 26),
      richRect: domRect(0, 0, 760, 400),
    };
    renderFeedLink("q-84", { title: "Hover no-fit detail" });
    const preview = screen.getByRole("button", { name: /Preview q-84/ });

    fireEvent.pointerEnter(preview, { pointerType: "mouse", clientX: 720, clientY: 245 });
    await act(async () => Promise.resolve());

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("quest-feed-rich-backdrop")).toBeNull();
    expect(preview).toHaveAttribute("aria-expanded", "false");
  });

  it("restores focused-link title intent after a hover-rich no-fit eye exit", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
    geometryFixture = {
      ...geometryFixture,
      sourceRects: [domRect(100, 110, 600, 280)],
      previewRect: domRect(710, 235, 26, 26),
      richRect: domRect(0, 0, 760, 400),
    };
    renderFeedLink("q-88", { title: "Focused no-fit recovery" });
    const link = screen.getByRole("link", { name: "q-88" });
    const preview = screen.getByRole("button", { name: /Preview q-88/ });
    link.focus();
    fireEvent.focus(link);
    expect(screen.getByTestId("quest-feed-title-preview")).toBeInTheDocument();

    fireEvent.pointerEnter(preview, { pointerType: "mouse", clientX: 720, clientY: 245 });
    await act(async () => Promise.resolve());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();
    expect(document.activeElement).toBe(link);

    fireEvent.pointerLeave(preview, { pointerType: "mouse", relatedTarget: null });
    expect(screen.getByTestId("quest-feed-title-preview")).toHaveTextContent("Focused no-fit recovery");
    expect(document.activeElement).toBe(link);
  });

  it("falls back to a labelled modal sheet when explicit desktop placement has no legal fit", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
    geometryFixture = {
      ...geometryFixture,
      sourceRects: [domRect(100, 110, 600, 280)],
      previewRect: domRect(710, 230, 70, 36),
      richRect: domRect(0, 0, 760, 400),
    };
    renderFeedLink("q-74", { title: "Impossible rich placement" });
    const preview = screen.getByRole("button", { name: /Preview q-74/ });

    fireEvent.click(preview, { detail: 0 });
    await act(async () => Promise.resolve());

    const dialog = screen.getByRole("dialog", { name: "Impossible rich placement" });
    expect(dialog).toHaveAttribute("data-surface", "bottom-sheet");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(preview).toHaveAttribute("aria-expanded", "true");
    expect(document.activeElement).toBe(dialog);

    fireEvent.keyDown(dialog, { key: "Escape" });
    await act(async () => vi.runOnlyPendingTimers());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(preview);

    resetGeometryFixture();
    renderFeedLink("q-75", { title: "Next preview owner" });
    fireEvent.focus(screen.getByRole("link", { name: "q-75" }));
    expect(screen.getByTestId("quest-feed-title-preview")).toHaveTextContent("Next preview owner");
  });

  it("rejects an old in-flight target after the keyed feed link rerenders", async () => {
    const oldRequest = deferred<Awaited<ReturnType<typeof api.getQuestValidated>>>();
    const newRequest = deferred<Awaited<ReturnType<typeof api.getQuestValidated>>>();
    const oldQuest = quest({ questId: "q-61", title: "Old target result" });
    const newQuest = quest({ questId: "q-62", title: "New target result" });
    mockGetQuestValidated.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    const view = render(
      <div data-message-id="rerendered-target">
        <QuestInlineLink questId="q-61" surface="chat-feed" />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview q-61" }), { detail: 0 });
    expect(screen.getByRole("dialog")).toHaveTextContent("q-61 preview");
    view.rerender(
      <div data-message-id="rerendered-target">
        <QuestInlineLink questId="q-62" surface="chat-feed" />
      </div>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Preview q-62" }), { detail: 0 });
    await act(async () => newRequest.resolve({ status: "fresh", data: newQuest, etag: '"new-target"' }));
    expect(screen.getByRole("dialog", { name: "New target result" })).toBeInTheDocument();

    await act(async () => oldRequest.resolve({ status: "fresh", data: oldQuest, etag: '"old-target"' }));
    expect(screen.getByRole("dialog", { name: "New target result" })).toBeInTheDocument();
    expect(screen.queryByText("Old target result")).toBeNull();
  });

  it("keeps a newer canonical title ahead of stale cached rich detail", async () => {
    const stale = quest({ questId: "q-63", title: "Stale detail title", version: 1, updatedAt: 10 });
    useStore.setState({
      questDetails: new Map([["q-63", stale]]),
      questDetailEtags: new Map([["q-63", '"stale"']]),
      questTitlePreviews: new Map([
        ["q-63", { questId: "q-63", title: "New canonical title", version: 2, updatedAt: 20 }],
      ]),
    });
    mockGetQuestValidated.mockResolvedValue({ status: "not-modified", etag: '"stale"' });
    renderFeedLink("q-63");
    const preview = screen.getByRole("button", { name: "Preview q-63: New canonical title" });

    fireEvent.pointerEnter(preview, { pointerType: "mouse", clientX: 210, clientY: 110 });
    expect(screen.getByRole("dialog", { name: "New canonical title" })).toHaveAttribute("data-open-mode", "hover");
    expect(screen.queryByTestId("quest-feed-title-preview")).toBeNull();
    fireEvent.click(preview, { detail: 0 });
    await act(async () => Promise.resolve());

    expect(screen.getByRole("dialog", { name: "New canonical title" })).toHaveAttribute("data-open-mode", "explicit");
  });

  it("accepts an injected by-id loader for deterministic rich success without global API mutation", async () => {
    const loaded = quest({ questId: "q-64", title: "Injected rich state", tldr: "Fixture detail" });
    const loadQuest = vi.fn(async () => loaded);
    render(
      <div data-message-id="loader-seam">
        <QuestFeedInlineLink questId="q-64" className="cc-quest-link" stopPropagation={false} loadQuest={loadQuest} />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview q-64" }), { detail: 0 });
    await act(async () => Promise.resolve());

    const dialog = screen.getByRole("dialog", { name: "Injected rich state" });
    expect(dialog).toHaveTextContent("Fixture detail");
    expect(loadQuest).toHaveBeenCalledWith("q-64");
    expect(mockGetQuestValidated).not.toHaveBeenCalled();
  });

  it("uses and traps a modal sheet for explicit keyboard activation on a wide coarse-capability layout", async () => {
    setMatchMedia({ coarse: true });
    renderFeedLink("q-65", { title: "Modal focus order" });
    const preview = screen.getByRole("button", { name: /Preview q-65/ });
    fireEvent.click(preview, { detail: 0 });
    await act(async () => Promise.resolve());
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-surface", "bottom-sheet");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const primary = within(dialog).getByRole("link", { name: "Open quest" });
    const close = within(dialog).getByRole("button", { name: "Close" });

    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(primary);
    fireEvent.keyDown(primary, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab" });
    expect(document.activeElement).toBe(dialog);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
