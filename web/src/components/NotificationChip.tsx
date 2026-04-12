import { useState, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../store.js";
import { api } from "../api.js";
import { navigateToSessionMessage } from "../utils/routing.js";
import type { SessionNotification } from "../types.js";

const EMPTY: SessionNotification[] = [];

function useNotifications(sessionId: string) {
  const all = useStore((s) => s.sessionNotifications?.get(sessionId)) ?? EMPTY;
  const active = useMemo(() => all.filter((n) => !n.done), [all]);
  const done = useMemo(() => all.filter((n) => n.done), [all]);
  return { all, active, done };
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function NotificationItem({
  notif,
  sessionId,
  onClose,
}: {
  notif: SessionNotification;
  sessionId: string;
  onClose: () => void;
}) {
  const toggleDone = useCallback(() => {
    api.markNotificationDone(sessionId, notif.id, !notif.done).catch(() => {});
  }, [sessionId, notif.id, notif.done]);

  const jumpToMessage = useCallback(() => {
    navigateToSessionMessage(sessionId, notif.messageIndex);
    onClose();
  }, [sessionId, notif.messageIndex, onClose]);

  const isNeedsInput = notif.category === "needs-input";

  return (
    <div className="flex items-start gap-2 px-4 py-2.5 hover:bg-cc-hover/40 transition-colors group">
      {/* Checkbox */}
      <button
        onClick={toggleDone}
        className="mt-0.5 shrink-0 w-4 h-4 rounded border border-cc-border/60 flex items-center justify-center cursor-pointer hover:border-cc-primary/50 transition-colors"
        aria-label={notif.done ? "Mark as active" : "Mark as done"}
      >
        {notif.done && (
          <svg className="w-3 h-3 text-cc-primary" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 8.5l3 3 6-6" />
          </svg>
        )}
      </button>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${isNeedsInput ? "bg-amber-400" : "bg-emerald-400"}`} />
          <button
            onClick={jumpToMessage}
            className={`text-[12px] text-left truncate max-w-[280px] cursor-pointer hover:underline ${notif.done ? "text-cc-muted/60 line-through" : "text-cc-fg/90"}`}
            title={notif.summary || notif.category}
          >
            {notif.summary || (isNeedsInput ? "Needs your input" : "Ready for review")}
          </button>
        </div>
        <div className="text-[10px] text-cc-muted/60 mt-0.5 pl-3">{formatRelativeTime(notif.timestamp)}</div>
      </div>
    </div>
  );
}

function NotificationInbox({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { active, done } = useNotifications(sessionId);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler, { capture: true });
    return () => document.removeEventListener("keydown", handler, { capture: true });
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Notification inbox"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-md mx-4 rounded-2xl border border-cc-border bg-cc-card/95 shadow-[0_25px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-cc-border/50">
          <h2 className="text-sm font-medium text-cc-fg">
            Notifications
            {active.length > 0 && (
              <span className="ml-2 text-[11px] text-cc-muted font-normal">({active.length} active)</span>
            )}
          </h2>
          <button
            onClick={onClose}
            className="text-cc-muted hover:text-cc-fg transition-colors p-1 -mr-1 cursor-pointer"
            aria-label="Close"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Notification list */}
        <div className="max-h-[60vh] overflow-y-auto">
          {active.length === 0 && done.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-cc-muted">No notifications</p>
          ) : (
            <>
              {/* Active notifications (newest first) */}
              {active.length > 0 && (
                <div className="divide-y divide-cc-border/20">
                  {[...active].reverse().map((n) => (
                    <NotificationItem key={n.id} notif={n} sessionId={sessionId} onClose={onClose} />
                  ))}
                </div>
              )}

              {/* Done section (collapsed by default) */}
              {done.length > 0 && (
                <div className="border-t border-cc-border/30">
                  <button
                    onClick={() => setShowDone((p) => !p)}
                    className="w-full flex items-center gap-1.5 px-4 py-2 text-[11px] text-cc-muted/70 hover:text-cc-muted cursor-pointer transition-colors"
                  >
                    <svg
                      className={`w-3 h-3 transition-transform ${showDone ? "rotate-90" : ""}`}
                      viewBox="0 0 16 16"
                      fill="currentColor"
                    >
                      <path d="M6 4l4 4-4 4z" />
                    </svg>
                    Done ({done.length})
                  </button>
                  {showDone && (
                    <div className="divide-y divide-cc-border/10 opacity-60">
                      {[...done].reverse().map((n) => (
                        <NotificationItem key={n.id} notif={n} sessionId={sessionId} onClose={onClose} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Glassmorphic floating pill for notification inbox. Renders nothing when no active notifications exist. */
export function NotificationChip({ sessionId }: { sessionId: string }) {
  const { active } = useNotifications(sessionId);
  const [modalOpen, setModalOpen] = useState(false);

  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  if (active.length === 0) return null;

  return (
    <>
      <button
        onClick={openModal}
        className="pointer-events-auto relative inline-flex max-w-[min(18rem,calc(100vw-2.75rem))] items-center gap-1.5 overflow-hidden rounded-[18px] border border-white/8 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] px-2.5 py-1 text-[11px] text-cc-muted font-mono-code shadow-[0_10px_30px_rgba(0,0,0,0.28)] backdrop-blur-md cursor-pointer hover:border-white/15 transition-colors"
      >
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.10),transparent_55%)]" />
        <span className="relative">
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5c0 2.5-1.5 4-1.5 4h12s-1.5-1.5-1.5-4A4.5 4.5 0 0 0 8 1.5z" />
            <path d="M6 12a2 2 0 0 0 4 0" />
          </svg>
        </span>
        <span className="relative truncate text-cc-fg/90">
          {active.length} {active.length === 1 ? "notification" : "notifications"}
        </span>
      </button>

      {modalOpen && <NotificationInbox sessionId={sessionId} onClose={closeModal} />}
    </>
  );
}
