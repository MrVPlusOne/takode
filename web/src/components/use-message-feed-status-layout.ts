import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useStore } from "../store.js";
import { selectLeaderThreadStatuses } from "../utils/leader-thread-tabs-resolver.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";
import { getVisibleCurrentThreadStatuses } from "./MessageFeedThreadStatus.js";
import type { MessageFeedEndSlackProps } from "./MessageFeedEndSlack.js";

const FEED_EXTRA_SCROLL_SLACK_PX = 12;
const FLOATING_STATUS_SPACER_MARGIN_PX = 4;
const FLOATING_STATUS_MOBILE_BOTTOM_PX = 8;
const MOBILE_NAV_BASE_BOTTOM_PX = 12;
const MOBILE_NAV_STATUS_CLEARANCE_GAP_PX = 8;
const CENTERED_FEED_STATUS_CLEARANCE_GAP_PX = 64;

interface ThreadStatusMeasurement {
  statusSignature: string;
  currentHeight: number;
  highWaterHeight: number;
}

interface ThreadStatusVisibility {
  visible: boolean;
  appearanceEpoch: number;
}

const MAX_THREAD_STATUS_SCOPES = 32;

export function useMessageFeedStatusLayout(sessionId: string, currentThreadKey: string) {
  const normalizedThreadKey = normalizeThreadKey(currentThreadKey);
  const statusScope = `${sessionId}:${normalizedThreadKey}`;
  const currentThreadStatuses = useStore((state) => selectLeaderThreadStatuses(state, sessionId));
  const visibleThreadStatuses = useMemo(
    () => getVisibleCurrentThreadStatuses(currentThreadStatuses, normalizedThreadKey),
    [currentThreadStatuses, normalizedThreadKey],
  );
  const visibleThreadStatusContentSignature = useMemo(
    () =>
      visibleThreadStatuses
        .map((status) =>
          [status.threadKey, status.kind, status.label, status.summary, status.messageId, status.updatedAt].join(
            "\u0001",
          ),
        )
        .join("\u0002"),
    [visibleThreadStatuses],
  );
  const [floatingStatusHeight, setFloatingStatusHeight] = useState(0);
  const [floatingStatusRunwayHeight, setFloatingStatusRunwayHeight] = useState(0);
  const threadStatusMeasurementsRef = useRef<ReadonlyMap<string, ThreadStatusMeasurement>>(new Map());
  const threadStatusVisibilityRef = useRef<ReadonlyMap<string, ThreadStatusVisibility>>(new Map());
  const activeThreadStatusScopeRef = useRef<string | null>(null);
  const [, setThreadStatusMeasurementRevision] = useState(0);
  const threadStatusVisible = visibleThreadStatuses.length > 0;
  const previousVisibility = threadStatusVisibilityRef.current.get(statusScope);
  const appearanceEpoch =
    threadStatusVisible && (previousVisibility?.visible !== true || activeThreadStatusScopeRef.current !== statusScope)
      ? (previousVisibility?.appearanceEpoch ?? 0) + 1
      : (previousVisibility?.appearanceEpoch ?? 0);
  const visibleThreadStatusSignature = threadStatusVisible
    ? `${appearanceEpoch}\u0000${visibleThreadStatusContentSignature}`
    : "";

  useLayoutEffect(() => {
    const next = new Map(threadStatusVisibilityRef.current);
    next.delete(statusScope);
    next.set(statusScope, { visible: threadStatusVisible, appearanceEpoch });
    while (next.size > MAX_THREAD_STATUS_SCOPES) {
      const oldestScope = next.keys().next().value as string | undefined;
      if (!oldestScope) break;
      next.delete(oldestScope);
    }
    threadStatusVisibilityRef.current = next;
    activeThreadStatusScopeRef.current = statusScope;
  }, [appearanceEpoch, statusScope, threadStatusVisible]);

  const handleThreadStatusLayoutContributionChange = useCallback(
    (height: number) => {
      if (!Number.isFinite(height) || height <= 0) return;
      const measuredHeight = Math.ceil(height);
      const previousByScope = threadStatusMeasurementsRef.current;
      const previous = previousByScope.get(statusScope);
      const highWaterHeight = previous ? Math.max(previous.highWaterHeight, measuredHeight) : measuredHeight;
      if (
        previous?.statusSignature === visibleThreadStatusSignature &&
        previous.currentHeight === measuredHeight &&
        previous.highWaterHeight === highWaterHeight
      ) {
        return;
      }
      const next = new Map(previousByScope);
      next.delete(statusScope);
      next.set(statusScope, {
        statusSignature: visibleThreadStatusSignature,
        currentHeight: measuredHeight,
        highWaterHeight,
      });
      while (next.size > MAX_THREAD_STATUS_SCOPES) {
        const oldestScope = next.keys().next().value as string | undefined;
        if (!oldestScope) break;
        next.delete(oldestScope);
      }
      threadStatusMeasurementsRef.current = next;
      setThreadStatusMeasurementRevision((revision) => revision + 1);
    },
    [statusScope, visibleThreadStatusSignature],
  );

  const scopedThreadStatusMeasurement = threadStatusMeasurementsRef.current.get(statusScope) ?? null;
  const currentThreadStatusHeight =
    threadStatusVisible && scopedThreadStatusMeasurement?.statusSignature === visibleThreadStatusSignature
      ? scopedThreadStatusMeasurement.currentHeight
      : 0;
  // Retain one bounded high-water per mounted session/thread. Clearing it while the
  // footer is absent would recreate the same physical-bottom clamp; unmounting the
  // feed releases the reservation, and the map cannot grow beyond the fixed scope cap.
  const threadStatusCompensation = Math.max(
    0,
    (scopedThreadStatusMeasurement?.highWaterHeight ?? 0) - currentThreadStatusHeight,
  );
  const mobileNavBottomOffsetPx = Math.max(
    MOBILE_NAV_BASE_BOTTOM_PX,
    floatingStatusHeight > 0
      ? FLOATING_STATUS_MOBILE_BOTTOM_PX + floatingStatusHeight + MOBILE_NAV_STATUS_CLEARANCE_GAP_PX
      : 0,
  );
  const overlayRunwayHeight = Math.max(
    FEED_EXTRA_SCROLL_SLACK_PX,
    floatingStatusRunwayHeight > 0 ? floatingStatusRunwayHeight + FLOATING_STATUS_SPACER_MARGIN_PX : 0,
  );
  const centeredFeedStatusClearancePx =
    floatingStatusHeight > 0 ? floatingStatusHeight + CENTERED_FEED_STATUS_CLEARANCE_GAP_PX : 0;
  const feedEndScrollSlack = overlayRunwayHeight + threadStatusCompensation;
  const feedEndSlackProps: MessageFeedEndSlackProps = {
    height: feedEndScrollSlack,
    overlayRunwayHeight,
    currentThreadStatusHeight,
    threadStatusCompensation,
  };
  const threadStatusLayoutKey = `${visibleThreadStatusSignature}\u0000${currentThreadStatusHeight}\u0000${threadStatusCompensation}`;

  return {
    feedEndScrollSlack,
    feedEndSlackProps,
    centeredFeedStatusClearancePx,
    floatingStatusHeight,
    mobileNavBottomOffsetPx,
    overlayRunwayHeight,
    currentThreadStatusHeight,
    threadStatusCompensation,
    setFloatingStatusHeight,
    setFloatingStatusRunwayHeight,
    handleThreadStatusLayoutContributionChange,
    visibleThreadStatuses,
    visibleThreadStatusSignature,
    threadStatusLayoutKey,
  };
}

export function useMessageFeedStatusContentBottomSync(
  layoutKey: string,
  getRealContentBottom: () => number | null,
  lastObservedContentBottomRef: MutableRefObject<number | null>,
  lastSeenContentBottomRef: MutableRefObject<number | null>,
  setShowLatestPill: (visible: boolean) => void,
) {
  useLayoutEffect(() => {
    const realContentBottom = getRealContentBottom();
    lastObservedContentBottomRef.current = realContentBottom;
    lastSeenContentBottomRef.current = realContentBottom;
    setShowLatestPill(false);
  }, [getRealContentBottom, lastObservedContentBottomRef, lastSeenContentBottomRef, layoutKey, setShowLatestPill]);
}
