import { useState, useRef, useEffect, type MouseEvent, type ReactNode } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { QuestmasterTask } from "../types.js";
import { QuestHoverCard } from "./QuestHoverCard.js";
import { withQuestIdInHash } from "../utils/routing.js";

const questIndexCache = new WeakMap<QuestmasterTask[], Map<string, QuestmasterTask>>();
const questHoverFetches = new Map<string, Promise<void>>();

function findQuestById(quests: QuestmasterTask[], questId: string): QuestmasterTask | null {
  let index = questIndexCache.get(quests);
  if (!index) {
    index = new Map(quests.map((quest) => [quest.questId.toLowerCase(), quest]));
    questIndexCache.set(quests, index);
  }
  return index.get(questId.toLowerCase()) ?? null;
}

function fetchQuestDetailForHover(questId: string): Promise<void> {
  const key = questId.toLowerCase();
  const state = useStore.getState();
  const currentEtag = state.questDetailEtags.get(key) ?? null;
  const fetchKey = `${key}\0${currentEtag ?? ""}`;

  const existing = questHoverFetches.get(fetchKey);
  if (existing) return existing;

  const fetchPromise = api
    .getQuestValidated(questId, currentEtag)
    .then((result) => {
      if (result.status === "fresh") {
        useStore.getState().upsertQuestDetail(result.data, { etag: result.etag });
      }
    })
    .finally(() => {
      if (questHoverFetches.get(fetchKey) === fetchPromise) {
        questHoverFetches.delete(fetchKey);
      }
    });

  questHoverFetches.set(fetchKey, fetchPromise);
  return fetchPromise;
}

export function QuestInlineLink({
  questId,
  children,
  className = "text-cc-primary hover:underline",
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
    void fetchQuestDetailForHover(questId)
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
