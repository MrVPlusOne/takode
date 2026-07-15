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
  transitionedAt = 100,
  targetThreadFreshness = "new_quest_thread",
}: {
  sourceThreadKey: string;
  targetThreadKey: string;
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
        markerKey: `thread-transition:${sourceThreadKey}->${targetThreadKey}:1`,
        sourceThreadKey,
        ...(sourceThreadKey.startsWith("q-") ? { sourceQuestId: sourceThreadKey } : {}),
        threadKey: targetThreadKey,
        questId: targetThreadKey,
        transitionedAt,
        reason: "route_switch",
        sourceMessageIndex: 1,
        targetThreadFreshness,
      },
    },
  };
}

function AutoSwitchHarness({
  messages,
  selectedThreadKey,
  routeThreadKey = selectedThreadKey,
  openThreadTab = () => {},
  setSelectedThreadKey = () => {},
}: {
  messages: ChatMessage[];
  selectedThreadKey: string;
  routeThreadKey?: string | null;
  openThreadTab?: AutoSwitchProps["openThreadTab"];
  setSelectedThreadKey?: AutoSwitchProps["setSelectedThreadKey"];
}) {
  const lastManualThreadSelectionAtRef = useRef(0);
  useLeaderThreadAutoSwitch({
    allMessages: messages,
    transitionMessages: messages,
    authoritativeLeaderOpenThreadTabs: leaderTabs([selectedThreadKey].filter((key) => key.startsWith("q-"))),
    hasThreadRoute: true,
    historyLoading: false,
    isLeaderSession: true,
    lastManualThreadSelectionAtRef,
    navigationThreadRows: [],
    openThreadTab,
    openThreadTabKeys: [selectedThreadKey].filter((key) => key.startsWith("q-")),
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
