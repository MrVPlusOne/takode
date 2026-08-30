import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { QuestListPreview, QuestmasterTask } from "../types.js";
import { useStore } from "../store.js";
import { openQuestOverlayRouteAware } from "../utils/routing.js";
import { QuestPreviewCardContent, QuestPreviewHeaderAction } from "./QuestPreviewCardContent.js";
import { rectFromEdges, toPreviewRect } from "./quest-feed-preview-geometry.js";
import { chooseLegacyQuestHoverPlacement } from "./quest-hover-card-placement.js";

interface QuestHoverCardProps {
  quest: QuestmasterTask | QuestListPreview;
  anchorRect: DOMRect;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  zIndexClassName?: string;
  onOpenQuest?: () => void;
}

export function QuestHoverCard({
  quest,
  anchorRect,
  onMouseEnter,
  onMouseLeave,
  zIndexClassName = "z-50",
  onOpenQuest,
}: QuestHoverCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const zoomLevel = useStore((state) => state.zoomLevel ?? 1);
  const cardWidth = getResponsiveCardWidth();
  const gap = 6;
  const left = anchorRect.left;
  const top = anchorRect.bottom + gap;

  useLayoutEffect(() => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const el = cardRef.current;

    const placement = chooseLegacyQuestHoverPlacement({
      anchorRect: toPreviewRect(anchorRect),
      layerSize: { width: rect.width, height: rect.height },
      placementWidth: cardWidth,
      viewport: rectFromEdges(0, 0, window.innerWidth, window.innerHeight),
      gap,
    });
    el.style.left = `${placement.left}px`;
    el.style.top = `${placement.top}px`;
  }, [anchorRect, cardWidth]);

  return createPortal(
    <div
      ref={cardRef}
      className={`fixed ${zIndexClassName} pointer-events-auto hidden-on-touch`}
      style={{ left, top, width: cardWidth, transform: `scale(${zoomLevel})`, transformOrigin: "top left" }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-testid="quest-hover-card"
    >
      <div className="max-h-[min(32rem,calc(100vh-1rem))] overflow-y-auto rounded-xl border border-cc-border bg-cc-card px-3 py-2.5 shadow-xl">
        <QuestPreviewCardContent
          quest={quest}
          headerAction={
            <QuestPreviewHeaderAction
              label="Open quest"
              ariaLabel={`Open ${quest.questId} quest details`}
              testId="quest-hover-open-button"
              onActivate={() => {
                openQuestOverlayRouteAware(quest.questId);
                onOpenQuest?.();
                onMouseLeave();
              }}
            />
          }
        />
      </div>
    </div>,
    document.body,
  );
}

function getResponsiveCardWidth(): number {
  const preferredWidth = 560;
  if (typeof window === "undefined") return preferredWidth;
  return Math.max(240, Math.min(preferredWidth, window.innerWidth - 16));
}
