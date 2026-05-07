import { useEffect, useRef, type RefObject } from "react";
import { api } from "../api.js";
import type { SessionNotification } from "../types.js";

type AutoResolvableNotification = Pick<SessionNotification, "id" | "category" | "done">;

export function useVisibleReviewNotificationAutoResolve<T extends HTMLElement>({
  sessionId,
  notification,
  enabled = true,
}: {
  sessionId?: string;
  notification?: AutoResolvableNotification | null;
  enabled?: boolean;
}): RefObject<T | null> {
  const elementRef = useRef<T>(null);
  const resolvedKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const element = elementRef.current;
    if (!enabled || !sessionId || !notification || !element) return;
    if (notification.category !== "review" || notification.done) return;

    const resolveKey = `${sessionId}:${notification.id}`;
    if (resolvedKeysRef.current.has(resolveKey)) return;

    const resolveNotification = () => {
      if (resolvedKeysRef.current.has(resolveKey)) return;
      resolvedKeysRef.current.add(resolveKey);
      api.markNotificationDone(sessionId, notification.id, true).catch(() => {
        resolvedKeysRef.current.delete(resolveKey);
      });
    };

    if (typeof IntersectionObserver !== "undefined") {
      let observer: IntersectionObserver | null = new IntersectionObserver((entries) => {
        if (!entries.some(isVisibleIntersection)) return;
        resolveNotification();
        observer?.disconnect();
        observer = null;
      });
      observer.observe(element);
      return () => observer?.disconnect();
    }

    const checkVisibility = () => {
      if (!isElementInViewport(element)) return;
      resolveNotification();
      removeFallbackListeners();
    };
    const removeFallbackListeners = () => {
      window.removeEventListener("scroll", checkVisibility, true);
      window.removeEventListener("resize", checkVisibility);
    };

    checkVisibility();
    window.addEventListener("scroll", checkVisibility, true);
    window.addEventListener("resize", checkVisibility);
    return removeFallbackListeners;
  }, [enabled, notification?.category, notification?.done, notification?.id, sessionId]);

  return elementRef;
}

function isVisibleIntersection(entry: IntersectionObserverEntry): boolean {
  return entry.isIntersecting && entry.intersectionRatio > 0;
}

function isElementInViewport(element: HTMLElement): boolean {
  if (typeof window === "undefined") return false;
  const rect = element.getBoundingClientRect();
  const width = window.innerWidth || document.documentElement.clientWidth || 0;
  const height = window.innerHeight || document.documentElement.clientHeight || 0;
  if (rect.width <= 0 || rect.height <= 0 || width <= 0 || height <= 0) return false;
  return rect.bottom > 0 && rect.right > 0 && rect.top < height && rect.left < width;
}
