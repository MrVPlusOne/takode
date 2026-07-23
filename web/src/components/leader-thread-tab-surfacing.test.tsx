// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import type { LeaderOpenThreadTabsState } from "../../shared/leader-open-thread-tabs.js";
import type { ChatMessage, ThreadTransitionMarker } from "../types.js";
import { useLeaderThreadTabSurfacing } from "./leader-thread-tab-surfacing.js";

type TabSurfacingProps = Parameters<typeof useLeaderThreadTabSurfacing>[0];

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

function TabSurfacingHarness({
  messages,
  selectedThreadKey,
  openThreadTab = () => {},
  openThreadTabKeys,
}: {
  messages: ChatMessage[];
  selectedThreadKey: string;
  openThreadTab?: TabSurfacingProps["openThreadTab"];
  openThreadTabKeys?: ReadonlyArray<string>;
}) {
  const effectiveOpenThreadTabKeys = openThreadTabKeys ?? [selectedThreadKey].filter((key) => key.startsWith("q-"));
  useLeaderThreadTabSurfacing({
    allMessages: messages,
    transitionMessages: messages,
    authoritativeLeaderOpenThreadTabs: leaderTabs([...effectiveOpenThreadTabKeys]),
    historyLoading: false,
    isLeaderSession: true,
    navigationThreadRows: [],
    openThreadTab,
    openThreadTabKeys: effectiveOpenThreadTabKeys,
    preview: false,
    questStatusByKey: new Map(),
    selectedThreadKey,
    sessionId: "s1",
  });
  return null;
}

describe("useLeaderThreadTabSurfacing transition markers", () => {
  it("surfaces a fresh transition from the selected non-Main source thread without selecting it", async () => {
    const openThreadTab = vi.fn<TabSurfacingProps["openThreadTab"]>();
    render(
      <TabSurfacingHarness
        messages={[transitionMarker({ sourceThreadKey: "q-1001", targetThreadKey: "q-1002" })]}
        openThreadTab={openThreadTab}
        selectedThreadKey="q-1001"
      />,
    );

    await waitFor(() =>
      expect(openThreadTab).toHaveBeenCalledWith("q-1002", {
        intent: "server_candidate",
        eventAt: 100,
        placement: "first",
      }),
    );
  });

  it("does not resurface the same target after the user manually returns to Main", async () => {
    const openThreadTab = vi.fn<TabSurfacingProps["openThreadTab"]>();
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
      <TabSurfacingHarness messages={[firstMarker]} openThreadTab={openThreadTab} selectedThreadKey="q-1670" />,
    );

    await waitFor(() => expect(openThreadTab).toHaveBeenCalledWith("q-1671", expect.any(Object)));

    openThreadTab.mockClear();

    rerender(
      <TabSurfacingHarness
        messages={[firstMarker, laterFreshLookingMarker]}
        openThreadTab={openThreadTab}
        openThreadTabKeys={["q-1671"]}
        selectedThreadKey="main"
      />,
    );

    await waitFor(() => expect(openThreadTab).not.toHaveBeenCalled());
  });

  it("does not surface when the transition source is not the selected thread", async () => {
    const openThreadTab = vi.fn<TabSurfacingProps["openThreadTab"]>();
    render(
      <TabSurfacingHarness
        messages={[transitionMarker({ sourceThreadKey: "q-1001", targetThreadKey: "q-1002" })]}
        openThreadTab={openThreadTab}
        selectedThreadKey="q-9999"
      />,
    );

    await waitFor(() => expect(openThreadTab).not.toHaveBeenCalled());
  });

  it("does not treat All Threads as a normal transition source", async () => {
    const openThreadTab = vi.fn<TabSurfacingProps["openThreadTab"]>();
    render(
      <TabSurfacingHarness
        messages={[transitionMarker({ sourceThreadKey: "all", targetThreadKey: "q-1002" })]}
        openThreadTab={openThreadTab}
        selectedThreadKey="all"
      />,
    );

    await waitFor(() => expect(openThreadTab).not.toHaveBeenCalled());
  });
});
