// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import type { LeaderOpenThreadTabsState } from "../../shared/leader-open-thread-tabs.js";
import type { ChatMessage, ThreadTransitionMarker } from "../types.js";
import { useLeaderThreadAutoSwitch } from "./leader-thread-auto-switch.js";

type AutoSwitchProps = Parameters<typeof useLeaderThreadAutoSwitch>[0];

const routingMocks = vi.hoisted(() => ({
  navigateToSessionThread: vi.fn(),
}));

const viewportMocks = vi.hoisted(() => ({
  persistLeaderSelectedThreadKey: vi.fn(),
  requestThreadViewportSnapshot: vi.fn(),
}));

vi.mock("../utils/routing.js", () => ({
  navigateToSessionThread: routingMocks.navigateToSessionThread,
}));

vi.mock("../utils/thread-viewport.js", () => ({
  persistLeaderSelectedThreadKey: viewportMocks.persistLeaderSelectedThreadKey,
  requestThreadViewportSnapshot: viewportMocks.requestThreadViewportSnapshot,
}));

function leaderTabs(keys: string[] = []): LeaderOpenThreadTabsState {
  return {
    version: 1,
    orderedOpenThreadKeys: keys,
    closedThreadTombstones: [],
    updatedAt: 1,
  };
}

function transitionMarker({
  sourceThreadKey,
  targetThreadKey,
  markerKey = `thread-transition:${sourceThreadKey}->${targetThreadKey}:1`,
  sourceMessageIndex = 1,
  transitionedAt = 100,
  targetThreadFreshness = "new_quest_thread",
}: {
  sourceThreadKey: string;
  targetThreadKey: string;
  markerKey?: string;
  sourceMessageIndex?: number;
  transitionedAt?: number;
  targetThreadFreshness?: ThreadTransitionMarker["targetThreadFreshness"];
}): ChatMessage {
  return {
    id: `transition-${sourceThreadKey}-${targetThreadKey}`,
    role: "system",
    content: `Work continued from thread:${sourceThreadKey} to thread:${targetThreadKey}`,
    timestamp: transitionedAt,
    historyIndex: -1,
    metadata: {
      threadTransitionMarker: {
        type: "thread_transition_marker",
        id: `transition-${sourceThreadKey}-${targetThreadKey}`,
        timestamp: transitionedAt,
        markerKey,
        sourceThreadKey,
        ...(sourceThreadKey.startsWith("q-") ? { sourceQuestId: sourceThreadKey } : {}),
        threadKey: targetThreadKey,
        questId: targetThreadKey,
        transitionedAt,
        reason: "route_switch",
        sourceMessageIndex,
        targetThreadFreshness,
      },
    },
  };
}

function AutoSwitchHarness({
  messages,
  selectedThreadKey,
  routeThreadKey = selectedThreadKey,
  lastManualThreadSelectionAt = 0,
  openThreadTab = () => {},
  openThreadTabKeys,
  setSelectedThreadKey = () => {},
}: {
  messages: ChatMessage[];
  selectedThreadKey: string;
  routeThreadKey?: string | null;
  lastManualThreadSelectionAt?: number;
  openThreadTab?: AutoSwitchProps["openThreadTab"];
  openThreadTabKeys?: ReadonlyArray<string>;
  setSelectedThreadKey?: AutoSwitchProps["setSelectedThreadKey"];
}) {
  const lastManualThreadSelectionAtRef = useRef(0);
  lastManualThreadSelectionAtRef.current = lastManualThreadSelectionAt;
  const effectiveOpenThreadTabKeys = openThreadTabKeys ?? [selectedThreadKey].filter((key) => key.startsWith("q-"));
  useLeaderThreadAutoSwitch({
    allMessages: messages,
    transitionMessages: messages,
    authoritativeLeaderOpenThreadTabs: leaderTabs([...effectiveOpenThreadTabKeys]),
    hasThreadRoute: true,
    historyLoading: false,
    isLeaderSession: true,
    lastManualThreadSelectionAtRef,
    navigationThreadRows: [],
    openThreadTab,
    openThreadTabKeys: effectiveOpenThreadTabKeys,
    preview: false,
    questStatusByKey: new Map(),
    routeThreadKey,
    selectedThreadKey,
    sessionId: "s1",
    setSelectedThreadKey,
  });
  return null;
}

describe("useLeaderThreadAutoSwitch transition markers", () => {
  beforeEach(() => {
    routingMocks.navigateToSessionThread.mockClear();
    viewportMocks.persistLeaderSelectedThreadKey.mockClear();
    viewportMocks.requestThreadViewportSnapshot.mockClear();
  });

  it("auto-selects a fresh transition from the selected non-Main source thread", async () => {
    const openThreadTab = vi.fn<AutoSwitchProps["openThreadTab"]>();
    const setSelectedThreadKey = vi.fn<AutoSwitchProps["setSelectedThreadKey"]>();
    render(
      <AutoSwitchHarness
        messages={[transitionMarker({ sourceThreadKey: "q-1001", targetThreadKey: "q-1002" })]}
        openThreadTab={openThreadTab}
        selectedThreadKey="q-1001"
        setSelectedThreadKey={setSelectedThreadKey}
      />,
    );

    await waitFor(() => expect(setSelectedThreadKey).toHaveBeenCalledWith("q-1002"));
    expect(openThreadTab).toHaveBeenCalledWith("q-1002", {
      intent: "server_candidate",
      eventAt: 100,
      placement: "first",
    });
    expect(routingMocks.navigateToSessionThread).toHaveBeenCalledWith("s1", "q-1002");
  });

  it("does not reselect the same target after the user manually returns to Main", async () => {
    const openThreadTab = vi.fn<AutoSwitchProps["openThreadTab"]>();
    const setSelectedThreadKey = vi.fn<AutoSwitchProps["setSelectedThreadKey"]>();
    const firstMarker = transitionMarker({
      sourceThreadKey: "q-1670",
      targetThreadKey: "q-1671",
      transitionedAt: 100,
    });
    const laterFreshLookingMarker = transitionMarker({
      sourceThreadKey: "main",
      targetThreadKey: "q-1671",
      markerKey: "thread-transition:main->q-1671:99",
      sourceMessageIndex: 99,
      transitionedAt: 200,
    });
    const { rerender } = render(
      <AutoSwitchHarness
        messages={[firstMarker]}
        openThreadTab={openThreadTab}
        selectedThreadKey="q-1670"
        setSelectedThreadKey={setSelectedThreadKey}
      />,
    );

    await waitFor(() => expect(setSelectedThreadKey).toHaveBeenCalledWith("q-1671"));
    expect(routingMocks.navigateToSessionThread).toHaveBeenCalledWith("s1", "q-1671");

    openThreadTab.mockClear();
    setSelectedThreadKey.mockClear();
    routingMocks.navigateToSessionThread.mockClear();
    viewportMocks.persistLeaderSelectedThreadKey.mockClear();
    viewportMocks.requestThreadViewportSnapshot.mockClear();

    rerender(
      <AutoSwitchHarness
        lastManualThreadSelectionAt={150}
        messages={[firstMarker, laterFreshLookingMarker]}
        openThreadTab={openThreadTab}
        openThreadTabKeys={["q-1671"]}
        routeThreadKey="main"
        selectedThreadKey="main"
        setSelectedThreadKey={setSelectedThreadKey}
      />,
    );

    await waitFor(() => expect(openThreadTab).not.toHaveBeenCalled());
    expect(setSelectedThreadKey).not.toHaveBeenCalled();
    expect(routingMocks.navigateToSessionThread).not.toHaveBeenCalled();
    expect(viewportMocks.persistLeaderSelectedThreadKey).not.toHaveBeenCalled();
  });

  it("does not steal focus when the transition source is not the selected thread", async () => {
    const openThreadTab = vi.fn<AutoSwitchProps["openThreadTab"]>();
    const setSelectedThreadKey = vi.fn<AutoSwitchProps["setSelectedThreadKey"]>();
    render(
      <AutoSwitchHarness
        messages={[transitionMarker({ sourceThreadKey: "q-1001", targetThreadKey: "q-1002" })]}
        openThreadTab={openThreadTab}
        selectedThreadKey="q-9999"
        setSelectedThreadKey={setSelectedThreadKey}
      />,
    );

    await waitFor(() => expect(openThreadTab).not.toHaveBeenCalled());
    expect(setSelectedThreadKey).not.toHaveBeenCalled();
    expect(routingMocks.navigateToSessionThread).not.toHaveBeenCalled();
  });

  it("does not treat All Threads as a normal transition source", async () => {
    const openThreadTab = vi.fn<AutoSwitchProps["openThreadTab"]>();
    const setSelectedThreadKey = vi.fn<AutoSwitchProps["setSelectedThreadKey"]>();
    render(
      <AutoSwitchHarness
        messages={[transitionMarker({ sourceThreadKey: "all", targetThreadKey: "q-1002" })]}
        openThreadTab={openThreadTab}
        routeThreadKey="all"
        selectedThreadKey="all"
        setSelectedThreadKey={setSelectedThreadKey}
      />,
    );

    await waitFor(() => expect(openThreadTab).not.toHaveBeenCalled());
    expect(setSelectedThreadKey).not.toHaveBeenCalled();
    expect(routingMocks.navigateToSessionThread).not.toHaveBeenCalled();
  });
});
