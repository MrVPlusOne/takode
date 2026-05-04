import { useState, useRef, useEffect, type MouseEvent, type ReactNode } from "react";
import { useStore } from "../store.js";
import type { QuestmasterTask } from "../types.js";
import { QuestHoverCard } from "./QuestHoverCard.js";
import { withQuestIdInHash } from "../utils/routing.js";

const questIndexCache = new WeakMap<QuestmasterTask[], Map<string, QuestmasterTask>>();

function findQuestById(quests: QuestmasterTask[], questId: string): QuestmasterTask | null {
  let index = questIndexCache.get(quests);
  if (!index) {
    index = new Map(quests.map((quest) => [quest.questId.toLowerCase(), quest]));
    questIndexCache.set(quests, index);
  }
  return index.get(questId.toLowerCase()) ?? null;
}

export function QuestInlineLink({
  questId,
  children,
  className = "text-cc-primary hover:underline",
  stopPropagation = false,
}: {
  questId: string;
  children?: ReactNode;
  className?: string;
  stopPropagation?: boolean;
}) {
  const quest = useStore((s) => findQuestById(s.quests, questId));
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const hideHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (hideHoverTimerRef.current) clearTimeout(hideHoverTimerRef.current);
    },
    [],
  );

  const questHash = withQuestIdInHash(window.location.hash, questId);

  function handleLinkMouseEnter(e: MouseEvent<HTMLAnchorElement>) {
    if (!quest) return;
    if (hideHoverTimerRef.current) clearTimeout(hideHoverTimerRef.current);
    setHoverRect(e.currentTarget.getBoundingClientRect());
  }

  function handleLinkMouseLeave() {
    if (hideHoverTimerRef.current) clearTimeout(hideHoverTimerRef.current);
    hideHoverTimerRef.current = setTimeout(() => setHoverRect(null), 100);
  }

  function handleHoverCardEnter() {
    if (hideHoverTimerRef.current) clearTimeout(hideHoverTimerRef.current);
  }

  function handleHoverCardLeave() {
    setHoverRect(null);
  }

  return (
    <>
      <a
        href={questHash}
        onClick={(e) => {
          e.preventDefault();
          if (stopPropagation) e.stopPropagation();
          useStore.getState().openQuestOverlay(questId);
        }}
        onMouseEnter={handleLinkMouseEnter}
        onMouseLeave={handleLinkMouseLeave}
        className={className}
        title={`Open ${questId}`}
      >
        {children ?? questId}
      </a>
      {quest && hoverRect && (
        <QuestHoverCard
          quest={quest}
          anchorRect={hoverRect}
          onMouseEnter={handleHoverCardEnter}
          onMouseLeave={handleHoverCardLeave}
        />
      )}
    </>
  );
}
