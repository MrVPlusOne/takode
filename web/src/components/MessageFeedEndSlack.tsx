export interface MessageFeedEndSlackProps {
  height: number;
  overlayRunwayHeight: number;
  currentThreadStatusHeight: number;
  threadStatusCompensation: number;
  targetScrollSpace?: number;
}

export function MessageFeedEndSlack({
  height,
  overlayRunwayHeight,
  currentThreadStatusHeight,
  threadStatusCompensation,
  targetScrollSpace = 0,
}: MessageFeedEndSlackProps) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none"
      data-feed-end-slack="true"
      data-feed-overlay-runway-height={overlayRunwayHeight}
      data-feed-thread-status-height={currentThreadStatusHeight}
      data-feed-thread-status-compensation={threadStatusCompensation}
      data-feed-target-scroll-space={targetScrollSpace}
      style={{ height: `${height}px` }}
    />
  );
}
