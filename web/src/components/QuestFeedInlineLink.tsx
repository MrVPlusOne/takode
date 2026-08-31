import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  forwardRef,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { isDeletedQuestFeedbackEntry } from "../../shared/quest-feedback.js";
import { useStore } from "../store.js";
import type { QuestmasterTask } from "../types.js";
import { navigateTo } from "../utils/navigation.js";
import { hydrateQuestDetail } from "../utils/quest-detail-hydration.js";
import { getQuestLeaderSessionId } from "../utils/quest-helpers.js";
import { getQuestStatusTheme } from "../utils/quest-status-theme.js";
import { resolveLeaderThreadTabsProjection } from "../utils/leader-thread-tabs-resolver.js";
import { selectCanonicalQuestTitle } from "../utils/quest-title-index.js";
import { useHashLocation } from "../utils/hash-location.js";
import {
  openQuestOverlayRouteAware,
  routeSessionRefForId,
  sessionThreadHash,
  withQuestFeedbackInHash,
  withQuestIdInHash,
} from "../utils/routing.js";
import { QuestPreviewCardContent, QuestPreviewHeaderAction } from "./QuestPreviewCardContent.js";
import { chooseLegacyQuestHoverPlacement } from "./quest-hover-card-placement.js";
import {
  chooseQuestBlockSheetPlacement,
  chooseQuestRichPopoverPlacement,
  chooseQuestSideSheetPlacement,
  chooseQuestTitlePlacement,
  collectNonEmptyClientRects,
  getVisualViewportRect,
  previewRectVisibleInViewport,
  type PreviewPlacement,
  type PreviewPoint,
  type PreviewRect,
} from "./quest-feed-preview-geometry.js";

const MICRO_ARM_MS = 250;
const MICRO_LEAVE_GRACE_MS = 150;
const TITLE_LOGICAL_WIDTH_PX = 320;
const RICH_LOGICAL_WIDTH_PX = 560;
const RICH_MIN_SIDE_WIDTH_PX = 280;
const RICH_MAX_LOGICAL_HEIGHT_PX = 544;
const NARROW_RICH_BREAKPOINT_PX = 640;
const NEARBY_CONTROL_GAP_PX = 72;

const FOCUSABLE_CONTROL_SELECTOR =
  'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,iframe,audio[controls],video[controls],[contenteditable]:not([contenteditable="false"]),[tabindex]:not([tabindex="-1"])';

const questIndexCache = new WeakMap<QuestmasterTask[], Map<string, QuestmasterTask>>();

function findQuestById(quests: QuestmasterTask[], questId: string): QuestmasterTask | null {
  let index = questIndexCache.get(quests);
  if (!index) {
    index = new Map(quests.map((quest) => [quest.questId.toLowerCase(), quest]));
    questIndexCache.set(quests, index);
  }
  return index.get(questId.toLowerCase()) ?? null;
}

type PreviewPhase = "idle" | "arming" | "micro" | "rich-loading" | "rich-ready" | "rich-error";
type ControlKey = "link" | "preview" | "preview-proxy" | "rich";
type RichOpenMode = "hover" | "explicit";
type RichPlacement =
  | ({ kind: "popover"; width: number; maxHeight: number; hoverActivationRect?: PreviewRect } & PreviewPlacement)
  | {
      kind: "side-sheet";
      edge: "left" | "right" | "top" | "bottom";
      left: number;
      top: number;
      width: number;
      maxHeight: number;
    }
  | { kind: "bottom-sheet"; left: number; top: number; width: number; maxHeight: number };

type ActivePreviewOwner = { id: string; kind: "transient" | "rich"; close: () => void };
let activePreviewOwner: ActivePreviewOwner | null = null;

function claimActivePreview(owner: ActivePreviewOwner): boolean {
  if (activePreviewOwner?.id === owner.id) {
    activePreviewOwner = owner;
    return true;
  }
  if (activePreviewOwner?.kind === "rich" && owner.kind === "transient") return false;
  activePreviewOwner?.close();
  activePreviewOwner = owner;
  return true;
}

function releaseActivePreview(id: string): void {
  if (activePreviewOwner?.id === id) activePreviewOwner = null;
}

function clearTimer(timer: MutableRefObject<ReturnType<typeof setTimeout> | null>): void {
  if (timer.current) clearTimeout(timer.current);
  timer.current = null;
}

function isFineHoverPointer(pointerType: string): boolean {
  return pointerType === "mouse" || pointerType === "pen";
}

function hasCoarsePointerCapability(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(any-pointer: coarse)").matches;
}

function shouldUseBottomSheet(zoomLevel: number): boolean {
  const viewport = getVisualViewportRect();
  return viewport.width / zoomLevel < NARROW_RICH_BREAKPOINT_PX || hasCoarsePointerCapability();
}

function samePlacement(a: RichPlacement | null, b: RichPlacement | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function placementCoversRect(
  placement: PreviewPlacement,
  layerSize: { width: number; height: number },
  target: PreviewRect,
): boolean {
  return (
    placement.left < target.right &&
    placement.left + layerSize.width > target.left &&
    placement.top < target.bottom &&
    placement.top + layerSize.height > target.top
  );
}

function sameMicroPlacement(a: PreviewPlacement | null | undefined, b: PreviewPlacement | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.left === b.left && a.top === b.top && a.direction === b.direction;
}

function updateIfChanged<T>(setValue: (updater: (current: T) => T) => void, next: T, equal: (a: T, b: T) => boolean) {
  setValue((current) => (equal(current, next) ? current : next));
}

function interactiveRectsNearSource(
  source: HTMLAnchorElement,
  preview: HTMLButtonElement,
  ignoredPortal: HTMLElement | null,
  anchorRects: readonly PreviewRect[],
  nearbyGap: number,
) {
  // Both preview layers are fixed-position portals, so inspect the whole
  // document but treat only controls near the source/eye as hard exclusions.
  // Far-away app chrome may be temporarily occluded by a hover card; requiring
  // every viewport control to remain uncovered makes dense feeds impossible to
  // preview and previously caused explicit activation to look inert.
  const viewport = getVisualViewportRect();
  const rects = [];
  for (const element of document.body.querySelectorAll<HTMLElement>(FOCUSABLE_CONTROL_SELECTOR)) {
    if (element === source || element === preview || ignoredPortal?.contains(element)) continue;
    if (element.hidden || element.getAttribute("aria-hidden") === "true" || element.closest("[inert]")) {
      continue;
    }
    const style = getComputedStyle(element);
    const opacity = Number.parseFloat(style.opacity);
    const untabbable = element.tabIndex < 0;
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      (untabbable && style.pointerEvents === "none") ||
      (untabbable && Number.isFinite(opacity) && opacity <= 0.01)
    ) {
      continue;
    }
    rects.push(
      ...collectNonEmptyClientRects(element).filter((rect) => {
        if (!previewRectVisibleInViewport(rect, viewport)) return false;
        return anchorRects.some((anchor) => {
          const horizontalGap = Math.max(anchor.left - rect.right, rect.left - anchor.right, 0);
          const verticalGap = Math.max(anchor.top - rect.bottom, rect.top - anchor.bottom, 0);
          return Math.hypot(horizontalGap, verticalGap) <= nearbyGap;
        });
      }),
    );
  }
  return rects;
}

function findNextFocusableAfter(element: HTMLElement): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_CONTROL_SELECTOR)).filter(
    (candidate) =>
      !candidate.hidden && candidate.getAttribute("aria-hidden") !== "true" && !candidate.closest("[inert]"),
  );
  const index = candidates.indexOf(element);
  return index >= 0 ? (candidates[index + 1] ?? null) : null;
}

function describeLoadError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "Quest preview could not be loaded.";
}

function previewFocusableControls(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_CONTROL_SELECTOR)).filter((control) => {
    if (control.hidden || control.getAttribute("aria-hidden") === "true" || control.closest("[inert]")) return false;
    if (control.tabIndex < 0) return false;
    const style = getComputedStyle(control);
    return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse";
  });
}

export function QuestFeedInlineLink({
  questId,
  children,
  className,
  stopPropagation,
  onNavigate,
  feedbackIndex,
  loadQuest = hydrateQuestDetail,
}: {
  questId: string;
  feedbackIndex?: number;
  children?: ReactNode;
  className: string;
  stopPropagation: boolean;
  onNavigate?: () => void;
  loadQuest?: (questId: string) => Promise<QuestmasterTask | null>;
}) {
  const normalizedQuestId = questId.toLowerCase();
  const quest = useStore(
    (state) => state.questDetails?.get(normalizedQuestId) ?? findQuestById(state.quests ?? [], normalizedQuestId),
  );
  const canonicalTitle = useStore((state) => {
    const listQuest = findQuestById(state.quests ?? [], normalizedQuestId);
    const detailQuest = state.questDetails?.get(normalizedQuestId) ?? null;
    const titlePreviews = state.questTitlePreviews;
    return selectCanonicalQuestTitle({
      questId: normalizedQuestId,
      listQuest,
      detailQuest,
      titlePreview: titlePreviews?.get(normalizedQuestId),
      titlePreviewKnown: titlePreviews?.has(normalizedQuestId) ?? false,
    });
  });
  const zoomLevel = useStore((state) => state.zoomLevel ?? 1);
  const colorTheme = useStore((state) => state.colorTheme);
  const hash = useHashLocation();
  const ownerId = useId();
  const dialogId = `${ownerId.replace(/:/g, "")}-quest-preview`;
  const headingId = `${dialogId}-heading`;
  const normalizedFeedbackIndex =
    Number.isSafeInteger(feedbackIndex) && feedbackIndex! >= 0 ? feedbackIndex : undefined;
  const questHash =
    normalizedFeedbackIndex === undefined
      ? withQuestIdInHash(hash, questId)
      : withQuestFeedbackInHash(hash, questId, normalizedFeedbackIndex);
  const parentQuestHash = withQuestIdInHash(hash, questId);
  const targetLabel =
    normalizedFeedbackIndex === undefined ? questId : `${questId} feedback #${normalizedFeedbackIndex}`;
  const linkRef = useRef<HTMLAnchorElement>(null);
  const previewRef = useRef<HTMLButtonElement>(null);
  const microRef = useRef<HTMLDivElement>(null);
  const richRef = useRef<HTMLDivElement>(null);
  const hoverActivationProxyRef = useRef<HTMLSpanElement>(null);
  const phaseRef = useRef<PreviewPhase>("idle");
  const [phase, setPhaseState] = useState<PreviewPhase>("idle");
  const [microPlacement, setMicroPlacement] = useState<PreviewPlacement | null | undefined>(undefined);
  const [microHydrationFailed, setMicroHydrationFailed] = useState(false);
  const [validatedMicroQuest, setValidatedMicroQuest] = useState<QuestmasterTask | null>(null);
  const [richPlacement, setRichPlacement] = useState<RichPlacement | null>(null);
  const [richError, setRichError] = useState<string | null>(null);
  const [validatedRichQuest, setValidatedRichQuest] = useState<QuestmasterTask | null>(null);
  const [richOpenMode, setRichOpenModeState] = useState<RichOpenMode | null>(null);
  const richOpenModeRef = useRef<RichOpenMode | null>(null);
  const epochRef = useRef(0);
  const hydrationEpochRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const hoverTargetsRef = useRef(new Set<ControlKey>());
  const focusTargetsRef = useRef(new Set<ControlKey>());
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusSuppressionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerFocusSuppressedRef = useRef(false);
  const pendingPreviewPointerTypeRef = useRef<string | null>(null);
  const hoverActivationPointerDownRef = useRef(false);
  const pendingFocusedLinkRestoreRef = useRef(false);
  const suppressedUntilExitRef = useRef(false);
  const openingPointerRef = useRef<PreviewPoint | null>(null);
  const lastActivationPointerTypeRef = useRef<string | null>(null);
  const nextFocusableRef = useRef<HTMLElement | null>(null);
  const focusedRichEpochRef = useRef<number | null>(null);
  const collectGeometryRef = useRef<() => void>(() => {});
  const pointerGeometryFrameRef = useRef<number | null>(null);
  const closeAllRef = useRef<(returnFocus?: boolean, dismissalModality?: string) => void>(() => {});
  const initialHashRef = useRef(hash);

  const syncPreviewColor = useCallback(() => {
    const link = linkRef.current;
    const preview = previewRef.current;
    if (!link || !preview) return;
    const color = getComputedStyle(link).color.trim();
    if (color) preview.style.setProperty("--cc-feed-preview-link-color", color);
    else preview.style.removeProperty("--cc-feed-preview-link-color");
  }, []);

  const schedulePreviewColorSync = useCallback(() => {
    requestAnimationFrame(syncPreviewColor);
  }, [syncPreviewColor]);

  useLayoutEffect(() => {
    syncPreviewColor();
  }, [className, colorTheme, syncPreviewColor]);

  const setPhase = useCallback((next: PreviewPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const setRichOpenMode = useCallback((next: RichOpenMode | null) => {
    richOpenModeRef.current = next;
    setRichOpenModeState(next);
  }, []);

  const resetSuppressionAfterExit = useCallback(() => {
    if (phaseRef.current.startsWith("rich")) return;
    if (hoverTargetsRef.current.size === 0 && focusTargetsRef.current.size === 0) {
      suppressedUntilExitRef.current = false;
      pointerFocusSuppressedRef.current = false;
      clearTimer(focusSuppressionTimerRef);
    }
  }, []);

  const closeAll = useCallback(
    (returnFocus = false, dismissalModality?: string) => {
      const focusReturnModality = dismissalModality ?? lastActivationPointerTypeRef.current;
      epochRef.current += 1;
      hydrationEpochRef.current = null;
      clearTimer(armTimerRef);
      clearTimer(leaveTimerRef);
      if (pointerGeometryFrameRef.current != null && pointerGeometryFrameRef.current >= 0) {
        cancelAnimationFrame(pointerGeometryFrameRef.current);
      }
      pointerGeometryFrameRef.current = null;
      setMicroPlacement(undefined);
      setMicroHydrationFailed(false);
      setValidatedMicroQuest(null);
      openingPointerRef.current = null;
      pendingPreviewPointerTypeRef.current = null;
      hoverActivationPointerDownRef.current = false;
      pendingFocusedLinkRestoreRef.current = false;
      setRichPlacement(null);
      setRichError(null);
      setValidatedRichQuest(null);
      hoverTargetsRef.current.delete("preview-proxy");
      setRichOpenMode(null);
      setPhase("idle");
      focusedRichEpochRef.current = null;
      hoverTargetsRef.current.delete("rich");
      releaseActivePreview(ownerId);
      if (!returnFocus && hoverTargetsRef.current.size === 0 && focusTargetsRef.current.size === 0) {
        suppressedUntilExitRef.current = false;
        pointerFocusSuppressedRef.current = false;
        clearTimer(focusSuppressionTimerRef);
      }
      if (returnFocus) {
        if (focusReturnModality === "keyboard") {
          suppressedUntilExitRef.current = false;
          pointerFocusSuppressedRef.current = false;
          clearTimer(focusSuppressionTimerRef);
        }
        const suppressRestoredFocus = focusReturnModality !== null && focusReturnModality !== "keyboard";
        if (suppressRestoredFocus) {
          pointerFocusSuppressedRef.current = true;
          if (focusReturnModality === "touch") suppressedUntilExitRef.current = true;
        }
        requestAnimationFrame(() => {
          if (!mountedRef.current) return;
          previewRef.current?.focus({ preventScroll: true });
          if (suppressRestoredFocus && focusReturnModality !== "touch") {
            clearTimer(focusSuppressionTimerRef);
            focusSuppressionTimerRef.current = setTimeout(() => {
              pointerFocusSuppressedRef.current = false;
            }, 0);
          }
        });
      }
    },
    [ownerId, setPhase, setRichOpenMode],
  );
  closeAllRef.current = closeAll;

  const claimThisPreview = useCallback(
    (kind: "transient" | "rich") => claimActivePreview({ id: ownerId, kind, close: () => closeAllRef.current(false) }),
    [ownerId],
  );

  const beginHydrationForEpoch = useCallback(
    (epoch: number) => {
      if (hydrationEpochRef.current === epoch) return;
      hydrationEpochRef.current = epoch;
      void loadQuest(questId)
        .then((hydrated) => {
          if (!mountedRef.current || epochRef.current !== epoch) return;
          if (phaseRef.current === "arming" || phaseRef.current === "micro") {
            setValidatedMicroQuest(hydrated);
          }
        })
        .catch(() => {
          if (!mountedRef.current || epochRef.current !== epoch) return;
          if (phaseRef.current === "arming" || phaseRef.current === "micro") {
            setMicroHydrationFailed(true);
          }
        });
    },
    [loadQuest, questId],
  );

  const startRichHydration = useCallback(
    (epoch: number) => {
      hydrationEpochRef.current = epoch;
      void loadQuest(questId)
        .then((hydrated) => {
          if (!mountedRef.current || epochRef.current !== epoch || phaseRef.current !== "rich-loading") return;
          if (!hydrated) throw new Error(`Quest ${questId} is unavailable.`);
          setRichError(null);
          setValidatedRichQuest(hydrated);
          setPhase("rich-ready");
        })
        .catch((error) => {
          if (!mountedRef.current || epochRef.current !== epoch || phaseRef.current !== "rich-loading") return;
          setValidatedRichQuest(null);
          setRichError(describeLoadError(error));
          setPhase("rich-error");
        });
    },
    [loadQuest, questId, setPhase],
  );

  const beginMicroIntent = useCallback(
    (kind: "source-pointer" | "focus", pointer?: PreviewPoint) => {
      if (phaseRef.current.startsWith("rich") || suppressedUntilExitRef.current) return;
      pendingFocusedLinkRestoreRef.current = false;
      clearTimer(leaveTimerRef);
      if (!claimThisPreview("transient")) return;
      let epoch = epochRef.current;
      if (phaseRef.current === "idle") {
        epoch = ++epochRef.current;
        hydrationEpochRef.current = null;
        setMicroHydrationFailed(false);
        setValidatedMicroQuest(null);
      }
      beginHydrationForEpoch(epoch);
      openingPointerRef.current = kind === "focus" ? null : (pointer ?? null);
      if (kind === "focus") {
        clearTimer(armTimerRef);
        setPhase("micro");
        return;
      }
      if (phaseRef.current === "micro" || phaseRef.current === "arming") return;
      setPhase("arming");
      clearTimer(armTimerRef);
      armTimerRef.current = setTimeout(() => {
        if (!mountedRef.current || epochRef.current !== epoch || suppressedUntilExitRef.current) return;
        if (hoverTargetsRef.current.size === 0) return;
        setPhase("micro");
      }, MICRO_ARM_MS);
    },
    [beginHydrationForEpoch, claimThisPreview, setPhase],
  );

  const beginHoverRichPreview = useCallback(
    (pointerType: string) => {
      if (suppressedUntilExitRef.current) return;
      pendingFocusedLinkRestoreRef.current = false;
      if (phaseRef.current.startsWith("rich") && richOpenModeRef.current === "explicit") return;
      clearTimer(armTimerRef);
      clearTimer(leaveTimerRef);
      if (!claimThisPreview("transient")) return;
      if (phaseRef.current.startsWith("rich") && richOpenModeRef.current === "hover") return;
      setMicroPlacement(undefined);
      setMicroHydrationFailed(false);
      setValidatedMicroQuest(null);
      openingPointerRef.current = null;
      pendingPreviewPointerTypeRef.current = null;
      lastActivationPointerTypeRef.current = pointerType;
      setRichPlacement(null);
      setRichError(null);
      setValidatedRichQuest(null);
      setRichOpenMode("hover");
      nextFocusableRef.current = null;
      focusedRichEpochRef.current = null;
      const epoch = ++epochRef.current;
      hydrationEpochRef.current = null;
      setPhase("rich-loading");
      startRichHydration(epoch);
    },
    [claimThisPreview, setPhase, setRichOpenMode, startRichHydration],
  );

  const closeHoverRichAndRestoreLinkFocus = useCallback(
    (deferWhileEyeHovered = false) => {
      const restoreLinkFocus =
        !suppressedUntilExitRef.current &&
        focusTargetsRef.current.has("link") &&
        document.activeElement === linkRef.current;
      closeAllRef.current(false);
      if (!restoreLinkFocus) return;
      if (deferWhileEyeHovered && hoverTargetsRef.current.has("preview")) {
        pendingFocusedLinkRestoreRef.current = true;
        return;
      }
      beginMicroIntent("focus");
    },
    [beginMicroIntent],
  );

  const scheduleTransientClose = useCallback(() => {
    clearTimer(leaveTimerRef);
    leaveTimerRef.current = setTimeout(() => {
      if (phaseRef.current.startsWith("rich") && richOpenModeRef.current === "hover") {
        if (hoverTargetsRef.current.size > 0) return;
        closeHoverRichAndRestoreLinkFocus();
        resetSuppressionAfterExit();
        return;
      }
      if (hoverTargetsRef.current.size > 0 || focusTargetsRef.current.size > 0) return;
      if (phaseRef.current === "arming" || phaseRef.current === "micro") {
        closeAllRef.current(false);
      }
      resetSuppressionAfterExit();
    }, MICRO_LEAVE_GRACE_MS);
  }, [closeHoverRichAndRestoreLinkFocus, resetSuppressionAfterExit]);

  const dismissTransientWithEscape = useCallback(() => {
    const transientRich = phaseRef.current.startsWith("rich") && richOpenModeRef.current === "hover";
    if (phaseRef.current !== "arming" && phaseRef.current !== "micro" && !transientRich) return false;
    suppressedUntilExitRef.current = true;
    closeAllRef.current(false);
    return true;
  }, []);

  const schedulePointerGeometry = useCallback(() => {
    if (pointerGeometryFrameRef.current != null) return;
    // The -1 sentinel also behaves correctly in tests whose RAF callback runs
    // synchronously before requestAnimationFrame returns its numeric handle.
    pointerGeometryFrameRef.current = -1;
    const frame = requestAnimationFrame(() => {
      pointerGeometryFrameRef.current = null;
      collectGeometryRef.current();
    });
    if (pointerGeometryFrameRef.current === -1) pointerGeometryFrameRef.current = frame;
  }, []);

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!isFineHoverPointer(event.pointerType)) return;
      if (phaseRef.current !== "arming" && phaseRef.current !== "micro") return;
      openingPointerRef.current = { x: event.clientX, y: event.clientY };
      if (phaseRef.current === "micro") schedulePointerGeometry();
    },
    [schedulePointerGeometry],
  );

  const handlePointerEnter = useCallback(
    (control: ControlKey, event: PointerEvent<HTMLElement>) => {
      hoverTargetsRef.current.add(control);
      clearTimer(leaveTimerRef);
      if (!isFineHoverPointer(event.pointerType)) return;
      if (control === "preview" || control === "preview-proxy") {
        beginHoverRichPreview(event.pointerType);
        return;
      }
      if (control === "rich") return;
      if (phaseRef.current.startsWith("rich") && richOpenModeRef.current === "hover") {
        closeAllRef.current(false);
      }
      beginMicroIntent("source-pointer", {
        x: event.clientX,
        y: event.clientY,
      });
    },
    [beginHoverRichPreview, beginMicroIntent],
  );

  const handlePointerLeave = useCallback(
    (control: ControlKey, event: PointerEvent<HTMLElement>) => {
      hoverTargetsRef.current.delete(control);
      if (control === "preview" && pendingFocusedLinkRestoreRef.current) {
        pendingFocusedLinkRestoreRef.current = false;
        if (
          !suppressedUntilExitRef.current &&
          focusTargetsRef.current.has("link") &&
          document.activeElement === linkRef.current
        ) {
          beginMicroIntent("focus");
        }
      }
      const relatedControl =
        event.relatedTarget instanceof Element
          ? event.relatedTarget.closest<HTMLElement>(FOCUSABLE_CONTROL_SELECTOR)
          : null;
      const enteredOwnRichPreview =
        event.relatedTarget instanceof Node && richRef.current?.contains(event.relatedTarget);
      const enteredOwnActivationProxy =
        event.relatedTarget instanceof Node && hoverActivationProxyRef.current?.contains(event.relatedTarget);
      const enteredOtherInteractive =
        !enteredOwnRichPreview &&
        !enteredOwnActivationProxy &&
        relatedControl != null &&
        relatedControl !== linkRef.current &&
        relatedControl !== previewRef.current;
      const transientPhase =
        phaseRef.current === "arming" ||
        phaseRef.current === "micro" ||
        (phaseRef.current.startsWith("rich") && richOpenModeRef.current === "hover");
      if (enteredOtherInteractive && transientPhase) {
        if (phaseRef.current.startsWith("rich") && richOpenModeRef.current === "hover") {
          closeHoverRichAndRestoreLinkFocus();
        } else {
          closeAllRef.current(false);
        }
        return;
      }
      if (control === "link" && phaseRef.current === "arming") {
        closeAllRef.current(false);
      }
      if (
        hoverTargetsRef.current.size === 0 &&
        (richOpenModeRef.current === "hover" || focusTargetsRef.current.size === 0)
      ) {
        scheduleTransientClose();
      }
    },
    [beginMicroIntent, closeHoverRichAndRestoreLinkFocus, scheduleTransientClose],
  );

  const handleFocus = useCallback(
    (control: ControlKey) => {
      focusTargetsRef.current.add(control);
      clearTimer(leaveTimerRef);
      if (pointerFocusSuppressedRef.current) return;
      if (control === "preview") {
        if (phaseRef.current === "arming" || phaseRef.current === "micro") closeAllRef.current(false);
        return;
      }
      if (control === "rich") return;
      if (phaseRef.current.startsWith("rich") && richOpenModeRef.current === "hover") {
        closeAllRef.current(false);
      }
      beginMicroIntent("focus");
    },
    [beginMicroIntent],
  );

  const handleBlur = useCallback(
    (control: ControlKey, event: FocusEvent<HTMLElement>) => {
      focusTargetsRef.current.delete(control);
      const next = event.relatedTarget;
      if (next === linkRef.current) focusTargetsRef.current.add("link");
      if (next === previewRef.current) focusTargetsRef.current.add("preview");
      setTimeout(() => {
        if (!mountedRef.current) return;
        if (document.activeElement !== linkRef.current && document.activeElement !== previewRef.current) {
          focusTargetsRef.current.clear();
        }
        if (hoverTargetsRef.current.size === 0 && focusTargetsRef.current.size === 0) scheduleTransientClose();
      }, 0);
    },
    [scheduleTransientClose],
  );

  const handlePointerDown = useCallback((control: ControlKey, event: PointerEvent<HTMLElement>) => {
    const pointerType = event.pointerType || "mouse";
    lastActivationPointerTypeRef.current = pointerType;
    if (control === "preview" || control === "preview-proxy") pendingPreviewPointerTypeRef.current = pointerType;
    if (control === "preview-proxy") hoverActivationPointerDownRef.current = true;
    pointerFocusSuppressedRef.current = true;
    clearTimer(focusSuppressionTimerRef);
    if (pointerType === "touch") {
      suppressedUntilExitRef.current = true;
    } else {
      focusSuppressionTimerRef.current = setTimeout(() => {
        pointerFocusSuppressedRef.current = false;
      }, 0);
    }
    const shouldCloseTransient =
      phaseRef.current === "arming" ||
      phaseRef.current === "micro" ||
      (control === "link" && phaseRef.current.startsWith("rich") && richOpenModeRef.current === "hover");
    if (shouldCloseTransient) {
      closeAllRef.current(false);
    }
  }, []);

  const handleLinkClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (stopPropagation) event.stopPropagation();
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (normalizedFeedbackIndex === undefined) {
        openQuestOverlayRouteAware(questId);
      } else {
        useStore.getState().openQuestOverlay(questId, undefined, normalizedFeedbackIndex);
        navigateTo(questHash);
      }
      onNavigate?.();
    },
    [normalizedFeedbackIndex, onNavigate, questHash, questId, stopPropagation],
  );

  const activateRichPreview = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (stopPropagation) event.stopPropagation();
      pendingFocusedLinkRestoreRef.current = false;
      claimThisPreview("rich");
      const activationPointerType = pendingPreviewPointerTypeRef.current ?? (event.detail === 0 ? "keyboard" : "mouse");
      pendingPreviewPointerTypeRef.current = null;
      hoverActivationPointerDownRef.current = false;
      lastActivationPointerTypeRef.current = activationPointerType;
      clearTimer(armTimerRef);
      clearTimer(leaveTimerRef);
      setMicroPlacement(undefined);
      setMicroHydrationFailed(false);
      setValidatedMicroQuest(null);
      hoverTargetsRef.current.delete("preview-proxy");
      openingPointerRef.current = null;
      nextFocusableRef.current = previewRef.current ? findNextFocusableAfter(previewRef.current) : null;
      if (phaseRef.current.startsWith("rich")) {
        if (richOpenModeRef.current === "hover") {
          setRichOpenMode("explicit");
          focusedRichEpochRef.current = null;
        }
        return;
      }
      setRichPlacement(null);
      setRichError(null);
      setValidatedRichQuest(null);
      const epoch = ++epochRef.current;
      hydrationEpochRef.current = null;
      focusedRichEpochRef.current = null;
      setRichOpenMode("explicit");
      setPhase("rich-loading");
      startRichHydration(epoch);
    },
    [claimThisPreview, setPhase, setRichOpenMode, startRichHydration, stopPropagation],
  );

  const retryRichPreview = useCallback(() => {
    if (!phaseRef.current.startsWith("rich")) return;
    const epoch = ++epochRef.current;
    hydrationEpochRef.current = null;
    setRichError(null);
    setValidatedRichQuest(null);
    setPhase("rich-loading");
    startRichHydration(epoch);
  }, [setPhase, startRichHydration]);

  const collectGeometry = useCallback(() => {
    const source = linkRef.current;
    const preview = previewRef.current;
    if (!source || !preview || !source.isConnected || !preview.isConnected) {
      closeAllRef.current(false);
      return;
    }
    const sourceRects = collectNonEmptyClientRects(source);
    const previewRects = collectNonEmptyClientRects(preview);
    const triggerRect = previewRects[0];
    const viewport = getVisualViewportRect();
    if (
      !triggerRect ||
      sourceRects.length === 0 ||
      !sourceRects.some((rect) => previewRectVisibleInViewport(rect, viewport))
    ) {
      closeAllRef.current(false);
      return;
    }

    if (phaseRef.current.startsWith("rich") && richOpenModeRef.current === "hover" && richRef.current) {
      const hoverWidth = Math.min(RICH_LOGICAL_WIDTH_PX, Math.max(1, (viewport.width - 16) / zoomLevel));
      const hoverMaxHeight = Math.min(RICH_MAX_LOGICAL_HEIGHT_PX, Math.max(1, (viewport.height - 16) / zoomLevel));
      richRef.current.style.width = `${hoverWidth}px`;
      richRef.current.style.maxHeight = `${hoverMaxHeight}px`;
      const richRect = richRef.current.getBoundingClientRect();
      if (richRect.width <= 0 || richRect.height <= 0) return;
      const placement = chooseLegacyQuestHoverPlacement({
        anchorRect: triggerRect,
        layerSize: { width: richRect.width, height: richRect.height },
        viewport,
      });
      const hoverActivationRect =
        placementCoversRect(placement, richRect, triggerRect) || hoverActivationPointerDownRef.current
          ? triggerRect
          : undefined;
      if (!hoverActivationRect) hoverTargetsRef.current.delete("preview-proxy");
      updateIfChanged(
        setRichPlacement,
        { kind: "popover", ...placement, width: hoverWidth, maxHeight: hoverMaxHeight, hoverActivationRect },
        samePlacement,
      );
      return;
    }

    hoverTargetsRef.current.delete("preview-proxy");
    const ignoredPortal = phaseRef.current === "micro" ? microRef.current : richRef.current;
    const nearbyInteractiveRects = interactiveRectsNearSource(
      source,
      preview,
      ignoredPortal,
      [...sourceRects, triggerRect],
      NEARBY_CONTROL_GAP_PX * zoomLevel,
    );

    if (phaseRef.current === "micro" && canonicalTitle && microRef.current) {
      const titleWidth = Math.min(TITLE_LOGICAL_WIDTH_PX, Math.max(1, (viewport.width - 16) / zoomLevel));
      microRef.current.style.width = `${titleWidth}px`;
      const layerRect = microRef.current.getBoundingClientRect();
      const placement = chooseQuestTitlePlacement({
        sourceRects,
        triggerRect,
        layerSize: { width: layerRect.width, height: layerRect.height },
        interactiveRects: nearbyInteractiveRects,
        viewport,
        pointer: openingPointerRef.current,
      });
      updateIfChanged(setMicroPlacement, placement, sameMicroPlacement);
    }

    if (phaseRef.current.startsWith("rich") && richRef.current) {
      const richRect = richRef.current.getBoundingClientRect();
      const maxLogicalHeight = Math.max(
        1,
        Math.min(RICH_MAX_LOGICAL_HEIGHT_PX, Math.max(1, viewport.height - 24) / zoomLevel),
      );
      const placeBottomSheet = () => {
        const width = Math.min(RICH_LOGICAL_WIDTH_PX, Math.max(1, viewport.width - 24) / zoomLevel);
        const actualWidth = width * zoomLevel;
        const left = viewport.left + (viewport.width - actualWidth) / 2;
        const top = Math.max(
          viewport.top + 12,
          viewport.bottom - Math.min(richRect.height, maxLogicalHeight * zoomLevel) - 12,
        );
        const placement: RichPlacement = { kind: "bottom-sheet", left, top, width, maxHeight: maxLogicalHeight };
        updateIfChanged(setRichPlacement, placement, samePlacement);
      };
      const explicitRich = richOpenModeRef.current === "explicit";
      if (explicitRich && (lastActivationPointerTypeRef.current === "touch" || shouldUseBottomSheet(zoomLevel))) {
        placeBottomSheet();
        return;
      }

      const popover = chooseQuestRichPopoverPlacement({
        sourceRects,
        triggerRect,
        layerSize: { width: richRect.width, height: richRect.height },
        interactiveRects: nearbyInteractiveRects,
        viewport,
      });
      if (popover) {
        updateIfChanged(
          setRichPlacement,
          { kind: "popover", ...popover, width: RICH_LOGICAL_WIDTH_PX, maxHeight: maxLogicalHeight },
          samePlacement,
        );
        return;
      }

      const sideSheet = chooseQuestSideSheetPlacement({
        sourceRects: [...sourceRects, triggerRect],
        viewport,
        preferredWidth: richRect.width,
        preferredHeight: richRect.height,
        minimumWidth: RICH_MIN_SIDE_WIDTH_PX * zoomLevel,
        interactiveRects: nearbyInteractiveRects,
      });
      if (sideSheet) {
        const placement: RichPlacement = {
          kind: "side-sheet",
          edge: sideSheet.side,
          left: sideSheet.left,
          top: sideSheet.top,
          width: sideSheet.width / zoomLevel,
          maxHeight: sideSheet.maxHeight / zoomLevel,
        };
        updateIfChanged(setRichPlacement, placement, samePlacement);
        return;
      }

      const blockSheet = chooseQuestBlockSheetPlacement({
        sourceRects: [...sourceRects, triggerRect],
        interactiveRects: nearbyInteractiveRects,
        viewport,
        preferredWidth: Math.min(richRect.width, viewport.width - 16),
        preferredHeight: richRect.height,
        minimumHeight: Math.min(120 * zoomLevel, Math.max(1, viewport.height / 4)),
      });
      if (blockSheet) {
        const placement: RichPlacement = {
          kind: "side-sheet",
          edge: blockSheet.edge,
          left: blockSheet.left,
          top: blockSheet.top,
          width: blockSheet.width / zoomLevel,
          maxHeight: blockSheet.maxHeight / zoomLevel,
        };
        updateIfChanged(setRichPlacement, placement, samePlacement);
        return;
      }
      if (explicitRich) {
        placeBottomSheet();
        return;
      }
      closeHoverRichAndRestoreLinkFocus(true);
    }
  }, [canonicalTitle, closeHoverRichAndRestoreLinkFocus, zoomLevel]);

  collectGeometryRef.current = collectGeometry;

  useLayoutEffect(() => {
    if (phase === "micro" || phase.startsWith("rich")) collectGeometry();
  }, [canonicalTitle, collectGeometry, phase, richOpenMode, zoomLevel]);

  useEffect(() => {
    if (phase === "idle") return;
    let frame: number | null = null;
    const schedule = () => {
      if (frame != null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        collectGeometry();
      });
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    for (const element of [
      linkRef.current,
      previewRef.current,
      microRef.current,
      richRef.current,
      linkRef.current?.closest<HTMLElement>("[data-message-id],.markdown-body"),
    ]) {
      if (element) observer?.observe(element);
    }
    return () => {
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      observer?.disconnect();
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [collectGeometry, phase]);

  useLayoutEffect(() => {
    if (
      richOpenMode !== "explicit" ||
      !phase.startsWith("rich") ||
      !richPlacement ||
      focusedRichEpochRef.current === epochRef.current
    ) {
      return;
    }
    focusedRichEpochRef.current = epochRef.current;
    richRef.current?.focus({ preventScroll: true });
  }, [phase, richOpenMode, richPlacement]);

  useEffect(() => {
    if (!phase.startsWith("rich") || !richPlacement || richPlacement.kind === "bottom-sheet") return;
    const handleDocumentClick = (event: globalThis.MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        richRef.current?.contains(target) ||
        previewRef.current?.contains(target) ||
        hoverActivationProxyRef.current?.contains(target) ||
        (target instanceof Element &&
          target.closest<HTMLElement>("[data-quest-feed-preview-hit-proxy]")?.dataset.previewOwner === dialogId)
      ) {
        return;
      }
      closeAllRef.current(false);
    };
    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, [phase, richPlacement]);

  useLayoutEffect(() => {
    if (!phase.startsWith("rich") || richPlacement?.kind !== "bottom-sheet") return;
    const root = document.getElementById("root");
    const previousInert = root?.inert ?? false;
    const previousOverflow = document.body.style.overflow;
    if (root) root.inert = true;
    document.body.style.overflow = "hidden";
    return () => {
      if (root) root.inert = previousInert;
      document.body.style.overflow = previousOverflow;
    };
  }, [phase, richPlacement]);

  useEffect(() => {
    if (phase !== "arming" && phase !== "micro" && !(phase.startsWith("rich") && richOpenMode === "hover")) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (dismissTransientWithEscape()) event.preventDefault();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [dismissTransientWithEscape, phase, richOpenMode]);

  useEffect(() => {
    if (initialHashRef.current === hash) return;
    initialHashRef.current = hash;
    if (phaseRef.current !== "idle") closeAllRef.current(false);
  }, [hash]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer(armTimerRef);
      clearTimer(leaveTimerRef);
      clearTimer(focusSuppressionTimerRef);
      if (pointerGeometryFrameRef.current != null && pointerGeometryFrameRef.current >= 0) {
        cancelAnimationFrame(pointerGeometryFrameRef.current);
      }
      pointerGeometryFrameRef.current = null;
      epochRef.current += 1;
      releaseActivePreview(ownerId);
    };
  }, [ownerId]);

  const microVisible = phase === "micro" && canonicalTitle && !microHydrationFailed;
  const microStatusTheme = validatedMicroQuest ? getQuestStatusTheme(validatedMicroQuest.status) : null;
  const richOpen = phase.startsWith("rich");
  const previewAccessibleLabel = canonicalTitle
    ? `Preview ${targetLabel}: ${canonicalTitle}`
    : `Preview ${targetLabel}`;
  return (
    <>
      <a
        ref={linkRef}
        href={questHash}
        onClick={handleLinkClick}
        onPointerEnter={(event) => {
          syncPreviewColor();
          handlePointerEnter("link", event);
        }}
        onPointerLeave={(event) => {
          handlePointerLeave("link", event);
          schedulePreviewColorSync();
        }}
        onPointerMove={handlePointerMove}
        onPointerDown={(event) => handlePointerDown("link", event)}
        onFocus={() => {
          syncPreviewColor();
          handleFocus("link");
        }}
        onBlur={(event) => {
          handleBlur("link", event);
          schedulePreviewColorSync();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && dismissTransientWithEscape()) event.preventDefault();
        }}
        className={className}
      >
        {children ?? questId}
      </a>
      <button
        ref={previewRef}
        type="button"
        className="cc-feed-quest-preview-trigger"
        aria-label={previewAccessibleLabel}
        aria-haspopup="dialog"
        aria-expanded={richOpen}
        aria-controls={dialogId}
        data-rich-open-mode={richOpenMode ?? undefined}
        data-testid="quest-feed-preview-button"
        data-quest-id={normalizedQuestId}
        onPointerEnter={(event) => {
          syncPreviewColor();
          handlePointerEnter("preview", event);
        }}
        onPointerLeave={(event) => handlePointerLeave("preview", event)}
        onPointerMove={handlePointerMove}
        onPointerDown={(event) => {
          syncPreviewColor();
          handlePointerDown("preview", event);
        }}
        onPointerCancel={() => {
          pendingPreviewPointerTypeRef.current = null;
        }}
        onFocus={() => {
          syncPreviewColor();
          handleFocus("preview");
        }}
        onBlur={(event) => handleBlur("preview", event)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") pendingPreviewPointerTypeRef.current = null;
          if (event.key === "Escape" && dismissTransientWithEscape()) event.preventDefault();
        }}
        onClick={activateRichPreview}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M1.5 8s2.2-3.75 6.5-3.75S14.5 8 14.5 8 12.3 11.75 8 11.75 1.5 8 1.5 8Z" />
          <circle cx="8" cy="8" r="1.6" />
        </svg>
      </button>
      {richOpenMode === "hover" &&
        richPlacement?.kind === "popover" &&
        richPlacement.hoverActivationRect &&
        createPortal(
          // The real eye stays the only accessible control. This pointer-only body portal
          // bridges the app root's transform stacking context when the hover card covers it.
          // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only bridge for the accessible eye control
          <span
            ref={hoverActivationProxyRef}
            aria-hidden="true"
            data-testid="quest-feed-preview-hit-proxy"
            data-quest-feed-preview-hit-proxy="true"
            data-preview-owner={dialogId}
            className="fixed z-[83] cursor-pointer"
            style={{
              left: richPlacement.hoverActivationRect.left,
              top: richPlacement.hoverActivationRect.top,
              width: richPlacement.hoverActivationRect.width,
              height: richPlacement.hoverActivationRect.height,
            }}
            onPointerEnter={(event) => handlePointerEnter("preview-proxy", event)}
            onPointerLeave={(event) => handlePointerLeave("preview-proxy", event)}
            onPointerDown={(event) => {
              event.preventDefault();
              handlePointerDown("preview-proxy", event);
            }}
            onPointerCancel={() => {
              pendingPreviewPointerTypeRef.current = null;
              hoverActivationPointerDownRef.current = false;
              schedulePointerGeometry();
            }}
            onClick={activateRichPreview}
          />,
          document.body,
        )}
      {microVisible &&
        createPortal(
          <div
            ref={microRef}
            aria-hidden="true"
            data-testid="quest-feed-title-preview"
            data-placement={microPlacement?.direction ?? (microPlacement === null ? "no-fit" : "measuring")}
            className="pointer-events-none fixed z-[70] max-h-[72px] overflow-hidden rounded-lg border border-cc-border bg-cc-card px-2.5 py-2 text-left shadow-lg"
            style={{
              left: microPlacement?.left ?? -10000,
              top: microPlacement?.top ?? -10000,
              visibility: microPlacement ? "visible" : "hidden",
              width: Math.min(TITLE_LOGICAL_WIDTH_PX, Math.max(1, (getVisualViewportRect().width - 16) / zoomLevel)),
              transform: `scale(${zoomLevel})`,
              transformOrigin: "top left",
            }}
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <div
                data-testid="quest-feed-title-preview-target"
                className="min-w-0 truncate text-[10px] font-medium uppercase tracking-wide text-cc-muted/70"
              >
                {targetLabel}
              </div>
              {microStatusTheme && (
                <span
                  data-testid="quest-feed-title-preview-status"
                  className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium leading-none ${microStatusTheme.bg} ${microStatusTheme.text} ${microStatusTheme.border}`}
                >
                  {microStatusTheme.label}
                </span>
              )}
            </div>
            <div className="mt-0.5 line-clamp-2 text-[13px] font-semibold leading-snug text-cc-fg">
              {canonicalTitle}
            </div>
          </div>,
          document.body,
        )}
      {richOpen &&
        createPortal(
          <QuestFeedRichPreview
            ref={richRef}
            id={dialogId}
            headingId={headingId}
            phase={phase}
            quest={phase === "rich-ready" ? (validatedRichQuest ?? quest) : null}
            questId={questId}
            displayTitle={canonicalTitle}
            targetLabel={targetLabel}
            feedbackIndex={normalizedFeedbackIndex}
            questHash={questHash}
            parentQuestHash={parentQuestHash}
            placement={richPlacement}
            openMode={richOpenMode ?? "explicit"}
            zoomLevel={zoomLevel}
            error={richError}
            onRetry={retryRichPreview}
            onClose={(returnFocus, dismissalPointerType) => closeAllRef.current(returnFocus, dismissalPointerType)}
            onNavigate={() => {
              closeAllRef.current(false);
              onNavigate?.();
            }}
            nextFocusable={nextFocusableRef.current}
            onPointerEnter={(event) => handlePointerEnter("rich", event)}
            onPointerLeave={(event) => handlePointerLeave("rich", event)}
          />,
          document.body,
        )}
    </>
  );
}

const QuestFeedRichPreview = forwardRef<
  HTMLDivElement,
  {
    id: string;
    headingId: string;
    phase: PreviewPhase;
    quest: QuestmasterTask | null;
    questId: string;
    displayTitle: string | null;
    targetLabel: string;
    feedbackIndex?: number;
    questHash: string;
    parentQuestHash: string;
    placement: RichPlacement | null;
    openMode: RichOpenMode;
    zoomLevel: number;
    error: string | null;
    onRetry: () => void;
    onClose: (returnFocus: boolean, dismissalModality?: string) => void;
    onNavigate: () => void;
    nextFocusable: HTMLElement | null;
    onPointerEnter: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerLeave: (event: PointerEvent<HTMLDivElement>) => void;
  }
>(function QuestFeedRichPreview(
  {
    id,
    headingId,
    phase,
    quest,
    questId,
    displayTitle,
    targetLabel,
    feedbackIndex,
    questHash,
    parentQuestHash,
    placement,
    openMode,
    zoomLevel,
    error,
    onRetry,
    onClose,
    onNavigate,
    nextFocusable,
    onPointerEnter,
    onPointerLeave,
  },
  ref,
) {
  const isModal = placement?.kind === "bottom-sheet";
  const feedback = feedbackIndex === undefined ? undefined : quest?.feedback?.[feedbackIndex];
  const feedbackUnavailable = feedbackIndex !== undefined && (!feedback || isDeletedQuestFeedbackEntry(feedback));
  const title = displayTitle?.trim() || quest?.title?.trim() || `${questId} preview`;
  const primaryActionLabel = feedbackIndex === undefined ? "Open quest" : `Open feedback #${feedbackIndex}`;
  const recordedLeaderSessionId = quest ? getQuestLeaderSessionId(quest) : null;
  const leaderThreadHref = useStore((state) => {
    if (!recordedLeaderSessionId) return null;
    const sdkSession = state.sdkSessions.find((session) => session.sessionId === recordedLeaderSessionId);
    const threadKey = questId.trim().toLowerCase();
    const hasBoardRow = [
      state.sessionBoards.get(recordedLeaderSessionId),
      state.sessionCompletedBoards.get(recordedLeaderSessionId),
    ].some((rows) => rows?.some((row) => row.questId.trim().toLowerCase() === threadKey));
    const hasProjectedThread = state.leaderProjections
      .get(recordedLeaderSessionId)
      ?.threadSummaries.some((summary) => summary.threadKey.trim().toLowerCase() === threadKey);
    const leaderTabsResolution = resolveLeaderThreadTabsProjection(state, recordedLeaderSessionId);
    const hasOpenThread =
      leaderTabsResolution.projectionState === "accepted" &&
      leaderTabsResolution.value.tabs.some((tab) => tab.threadKey === threadKey);
    if (!hasBoardRow && !hasProjectedThread && !hasOpenThread) return null;

    return sessionThreadHash(routeSessionRefForId(recordedLeaderSessionId, state.sdkSessions), questId);
  });
  const initialWidth = placement?.width ?? RICH_LOGICAL_WIDTH_PX;
  const maxHeight = placement?.maxHeight ?? RICH_MAX_LOGICAL_HEIGHT_PX;

  const dismissalPointerTypeRef = useRef<string | null>(null);

  const rememberDismissalPointer = (event: PointerEvent<HTMLElement>) => {
    dismissalPointerTypeRef.current = event.pointerType || "mouse";
  };

  const closeFromControl = (event: MouseEvent<HTMLElement>) => {
    const dismissalModality = dismissalPointerTypeRef.current ?? (event.detail === 0 ? "keyboard" : "mouse");
    dismissalPointerTypeRef.current = null;
    onClose(true, dismissalModality);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dismissalPointerTypeRef.current = null;
      onClose(true, "keyboard");
      return;
    }
    if (event.key !== "Tab") return;
    const container = event.currentTarget;
    const controls = previewFocusableControls(container);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;

    if (event.shiftKey && event.target === first) {
      event.preventDefault();
      container.focus();
      return;
    }
    if (event.shiftKey && event.target === container) {
      event.preventDefault();
      if (isModal) last.focus();
      else onClose(true, "keyboard");
      return;
    }
    if (!event.shiftKey && event.target === container) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (!event.shiftKey && event.target === last) {
      event.preventDefault();
      if (isModal) {
        container.focus();
      } else {
        onClose(false);
        requestAnimationFrame(() => {
          if (nextFocusable?.isConnected) nextFocusable.focus({ preventScroll: true });
        });
      }
    }
  };

  const style = {
    left: placement?.left ?? -10000,
    top: placement?.top ?? -10000,
    width: initialWidth,
    maxHeight,
    visibility: placement ? ("visible" as const) : ("hidden" as const),
    transform: `scale(${zoomLevel})`,
    transformOrigin: "top left",
  };
  const primaryAction = (
    <QuestPreviewHeaderAction
      label={primaryActionLabel}
      ariaLabel={primaryActionLabel}
      href={questHash}
      testId="quest-feed-primary-action"
      previewFocusable
      onActivate={onNavigate}
    />
  );

  const card = (
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-modal={isModal ? "true" : "false"}
      aria-labelledby={headingId}
      aria-busy={phase === "rich-loading" ? "true" : "false"}
      tabIndex={-1}
      data-testid="quest-feed-rich-preview"
      data-surface={placement?.kind ?? "measuring"}
      data-open-mode={openMode}
      data-edge={placement?.kind === "side-sheet" ? placement.edge : undefined}
      className={`fixed z-[82] overflow-y-auto rounded-xl border border-cc-border bg-cc-card px-3 py-2.5 text-left shadow-xl focus:outline-none ${
        placement?.kind === "side-sheet"
          ? placement.edge === "right"
            ? "rounded-r-none"
            : placement.edge === "left"
              ? "rounded-l-none"
              : placement.edge === "top"
                ? "rounded-t-none"
                : "rounded-b-none"
          : ""
      }`}
      style={style}
      onKeyDown={handleKeyDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {phase === "rich-ready" && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="quest-feed-rich-ready-announcement"
          className="sr-only"
        >
          Quest preview ready.
        </div>
      )}

      {phase === "rich-ready" && quest ? (
        <QuestPreviewCardContent
          quest={quest}
          eyebrowLabel={targetLabel}
          title={title}
          headingId={headingId}
          headerAction={primaryAction}
          suppressNestedHoverCards
        />
      ) : (
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-cc-muted">{targetLabel}</div>
            <h2
              id={headingId}
              data-testid="quest-feed-rich-title"
              className="mt-0.5 text-sm font-semibold leading-snug text-cc-fg break-words"
            >
              {title}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {phase === "rich-loading" && (
              <span
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="shrink-0 rounded-full border border-cc-border bg-cc-hover/40 px-2 py-1 text-[10px] text-cc-muted"
              >
                Refreshing…
              </span>
            )}
            {primaryAction}
          </div>
        </div>
      )}

      {phase === "rich-error" && (
        <div
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          data-testid="quest-feed-rich-error"
          className="mt-3 rounded-lg border border-cc-error/30 bg-cc-error/8 px-3 py-2 text-xs text-cc-error"
        >
          <div className="font-medium">Preview unavailable</div>
          <div className="mt-0.5 break-words text-cc-muted">{error ?? "Quest preview could not be loaded."}</div>
        </div>
      )}

      {phase === "rich-ready" && feedbackIndex !== undefined && (
        <div data-testid="quest-feed-feedback-context" className="mt-2 border-t border-cc-border/50 pt-2">
          {feedbackUnavailable ? (
            <div data-testid="quest-feed-feedback-unavailable" className="text-xs text-cc-muted">
              Feedback #{feedbackIndex} is unavailable at this stable index. The exact link remains unchanged.
            </div>
          ) : (
            <>
              <div className="text-[10px] font-medium uppercase tracking-wide text-cc-muted/70">
                Feedback #{feedbackIndex} · {feedback?.author === "human" ? "Human" : "Agent"}
              </div>
              <div className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-snug text-cc-muted">
                {feedback?.text}
              </div>
            </>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-cc-border/50 pt-2">
        {feedbackIndex !== undefined && (
          <a
            href={parentQuestHash}
            data-preview-focusable="true"
            data-testid="quest-feed-parent-action"
            className="cc-quest-link inline-flex min-h-8 items-center rounded-md px-2.5 py-1 text-xs hover:bg-cc-hover/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/50"
            onClick={onNavigate}
          >
            Open quest
          </a>
        )}
        {leaderThreadHref && (
          <a
            href={leaderThreadHref}
            data-preview-focusable="true"
            data-testid="quest-feed-thread-action"
            className="cc-session-link inline-flex min-h-8 items-center rounded-md px-2.5 py-1 text-xs text-cc-muted hover:bg-cc-hover/45 hover:text-cc-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/50"
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onNavigate();
              navigateTo(leaderThreadHref);
            }}
          >
            Open Thread
          </a>
        )}
        {phase === "rich-error" && (
          <button
            type="button"
            data-preview-focusable="true"
            className="inline-flex min-h-8 items-center rounded-md px-2.5 py-1 text-xs text-cc-muted hover:bg-cc-hover/45 hover:text-cc-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/50"
            onClick={onRetry}
          >
            Retry
          </button>
        )}
        <button
          type="button"
          data-preview-focusable="true"
          className="ml-auto inline-flex min-h-8 items-center rounded-md px-2.5 py-1 text-xs text-cc-muted hover:bg-cc-hover/45 hover:text-cc-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/50"
          onPointerDown={rememberDismissalPointer}
          onClick={closeFromControl}
        >
          Close
        </button>
      </div>
    </div>
  );

  if (!isModal) return card;
  return (
    <>
      <div
        aria-hidden="true"
        role="presentation"
        data-testid="quest-feed-rich-backdrop"
        className="fixed inset-0 z-[81] cursor-default bg-black/35"
        onPointerDown={rememberDismissalPointer}
        onClick={closeFromControl}
      />
      {card}
    </>
  );
});
