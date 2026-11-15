import { useEffect, useRef, useState } from "react";
import { useSdkSessionRow } from "../hooks/useSdkSessionRow.js";
import { useStore } from "../store.js";
import { hydrateQuestDetail } from "../utils/quest-detail-hydration.js";
import { navigateToSession, openQuestOverlayRouteAware } from "../utils/routing.js";
import { resolveSdkSessionNavigation } from "../utils/session-navigation-resolver.js";
import { splitPlainTakodeReferences, type PlainTakodeReference } from "./composer-reference-utils.js";
import { useHoverCardsSuppressed } from "./hover-card-suppression-context.js";
import { QuestHoverCard } from "./QuestHoverCard.js";
import { SessionHoverCard } from "./SessionHoverCard.js";

/** Marks a Markdown box whose links Cmd/Ctrl+click would open, so they look clickable. */
const MODIFIER_ATTRIBUTE = "data-link-modifier";

/**
 * Makes the quest and session references the Markdown box draws in `box` behave as links where
 * an editable box allows: hovering one with a mouse shows its quest or session card, as links in
 * the feed do, and Cmd/Ctrl+click opens it. A plain click or tap places the caret, as anywhere in
 * the text, so on a phone references are opened from the sent message.
 */
export function MarkdownReferenceLinks({ box }: { box: HTMLElement | null }) {
  const suppressed = useHoverCardsSuppressed();
  const [hover, setHover] = useState<{ reference: PlainTakodeReference; rect: DOMRect } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keep = () => clearTimeout(hideTimer.current);
  const hideSoon = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setHover(null), 100);
  };

  useEffect(() => {
    if (!box) return;
    let pointerInside = false;
    const linkAt = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>("[data-rich-text-box] .md-ref") : null;
    const move = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      pointerInside = true;
      box.toggleAttribute(MODIFIER_ATTRIBUTE, event.metaKey || event.ctrlKey);
      const link = linkAt(event.target);
      const reference = link && referenceIn(link);
      if (!link || !reference || suppressed) return hideSoon();
      keep();
      setHover((current) =>
        current && current.reference.text === reference.text
          ? current
          : { reference, rect: link.getBoundingClientRect() },
      );
    };
    const leave = () => {
      pointerInside = false;
      box.removeAttribute(MODIFIER_ATTRIBUTE);
      hideSoon();
    };
    const modifier = (event: KeyboardEvent) => {
      if (pointerInside) box.toggleAttribute(MODIFIER_ATTRIBUTE, event.metaKey || event.ctrlKey);
    };
    const click = (event: MouseEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const link = linkAt(event.target);
      const reference = link && referenceIn(link);
      if (!reference) return;
      event.preventDefault();
      setHover(null);
      openReference(reference);
    };
    box.addEventListener("pointermove", move);
    box.addEventListener("pointerleave", leave);
    box.addEventListener("click", click);
    window.addEventListener("keydown", modifier);
    window.addEventListener("keyup", modifier);
    return () => {
      box.removeEventListener("pointermove", move);
      box.removeEventListener("pointerleave", leave);
      box.removeEventListener("click", click);
      window.removeEventListener("keydown", modifier);
      window.removeEventListener("keyup", modifier);
      box.removeAttribute(MODIFIER_ATTRIBUTE);
      clearTimeout(hideTimer.current);
    };
  }, [box, suppressed]);

  if (!hover || suppressed) return null;
  const card = { anchorRect: hover.rect, onMouseEnter: keep, onMouseLeave: () => setHover(null) };
  return hover.reference.kind === "quest" ? (
    <QuestReferenceCard questId={hover.reference.questId} {...card} />
  ) : (
    <SessionReferenceCard sessionNum={hover.reference.sessionNum} {...card} />
  );
}

interface CardProps {
  anchorRect: DOMRect;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function QuestReferenceCard({ questId, ...card }: CardProps & { questId: string }) {
  const quest = useStore(
    (s) => s.questDetails?.get(questId) ?? s.quests.find((candidate) => candidate.questId.toLowerCase() === questId),
  );
  useEffect(() => {
    void hydrateQuestDetail(questId).catch(() => {});
  }, [questId]);
  return quest ? <QuestHoverCard quest={quest} {...card} /> : null;
}

function SessionReferenceCard({ sessionNum, ...card }: CardProps & { sessionNum: number }) {
  const sdkInfo = useSdkSessionRow(null, sessionNum);
  const navigation = sdkInfo ? resolveSdkSessionNavigation(sdkInfo) : null;
  const taskHistory = useStore((s) => (sdkInfo ? s.sessionTaskHistory.get(sdkInfo.sessionId) : undefined));
  if (!sdkInfo || !navigation) return null;
  return (
    <SessionHoverCard
      session={navigation.sidebarItem}
      sessionName={navigation.sidebarItem.name}
      sessionPreview={navigation.sidebarItem.lastMessagePreview || undefined}
      taskHistory={taskHistory}
      cliSessionId={sdkInfo.cliSessionId}
      {...card}
    />
  );
}

/** The reference a highlighted link in the Markdown box stands for. */
function referenceIn(link: HTMLElement): PlainTakodeReference | null {
  const [part] = splitPlainTakodeReferences(link.textContent ?? "");
  return part && part.kind !== "text" ? part : null;
}

function openReference(reference: PlainTakodeReference): void {
  if (reference.kind === "quest") {
    openQuestOverlayRouteAware(reference.questId);
    return;
  }
  const session = useStore.getState().sdkSessions.find((candidate) => candidate.sessionNum === reference.sessionNum);
  if (session) navigateToSession(session.sessionId);
}
