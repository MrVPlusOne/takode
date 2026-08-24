import { useState, useRef, useEffect, type MouseEvent, type ReactNode } from "react";
import { useStore } from "../store.js";
import type { QuestmasterTask } from "../types.js";
import { QuestHoverCard } from "./QuestHoverCard.js";
import { withQuestIdInHash } from "../utils/routing.js";
import { hydrateQuestDetail } from "../utils/quest-detail-hydration.js";

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
  className = "cc-quest-link hover:underline",
  stopPropagation = false,
  hoverCardZIndexClassName,
  onNavigate,
}: {
  questId: string;
  children?: ReactNode;
  className?: string;
  stopPropagation?: boolean;
  hoverCardZIndexClassName?: string;
  onNavigate?: () => void;
}) {
  const quest = useStore((s) => s.questDetails?.get(questId.toLowerCase()) ?? findQuestById(s.quests ?? [], questId));
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const [hoverFetchState, setHoverFetchState] = useState<"idle" | "loading" | "error">("idle");
  const hideHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (hideHoverTimerRef.current) clearTimeout(hideHoverTimerRef.current);
    };
  }, []);

  const questHash = withQuestIdInHash(window.location.hash, questId);
  const title =
    hoverFetchState === "loading"
      ? `Loading ${questId} preview`
      : hoverFetchState === "error"
        ? `Preview unavailable for ${questId}`
        : `Open ${questId}`;

  function handleLinkMouseEnter(e: MouseEvent<HTMLAnchorElement>) {
    if (hideHoverTimerRef.current) clearTimeout(hideHoverTimerRef.current);
    setHoverRect(e.currentTarget.getBoundingClientRect());
    setHoverFetchState("loading");
    void hydrateQuestDetail(questId)
      .then(() => {
        if (mountedRef.current) setHoverFetchState("idle");
      })
      .catch(() => {
        if (mountedRef.current) setHoverFetchState("error");
      });
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
          onNavigate?.();
        }}
        onMouseEnter={handleLinkMouseEnter}
        onMouseLeave={handleLinkMouseLeave}
        className={className}
        title={title}
      >
        {children ?? questId}
      </a>
      {quest && hoverRect && hoverFetchState === "idle" && (
        <QuestHoverCard
          quest={quest}
          anchorRect={hoverRect}
          onMouseEnter={handleHoverCardEnter}
          onMouseLeave={handleHoverCardLeave}
          zIndexClassName={hoverCardZIndexClassName}
          onOpenQuest={onNavigate}
        />
      )}
    </>
  );
}
