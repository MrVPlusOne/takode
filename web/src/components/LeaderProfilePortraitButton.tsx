import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { LeaderProfilePortrait } from "../../shared/leader-profile-portraits.js";
import { LEADER_PROFILE_POOLS, LEADER_PROFILE_PORTRAITS } from "../../shared/leader-profile-portraits.js";

const PANEL_MARGIN = 12;
const PANEL_GAP = 8;
const PANEL_WIDTH = 300;
const PANEL_MAX_HEIGHT = 520;
const PANEL_MIN_HEIGHT = 180;

interface LeaderProfilePortraitButtonProps {
  sessionId: string;
  portrait: LeaderProfilePortrait;
  size?: "sm" | "md" | "lg";
}

export function LeaderProfilePortraitButton({ sessionId, portrait, size = "sm" }: LeaderProfilePortraitButtonProps) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const updateSdkSession = useStore((state) => state.updateSdkSession);
  const portraitGroups = useMemo(() => {
    const orderedPools = [...LEADER_PROFILE_POOLS].sort((left, right) => {
      if (left.id === portrait.poolId) return -1;
      if (right.id === portrait.poolId) return 1;
      return 0;
    });
    return orderedPools
      .map((pool) => ({
        pool,
        portraits: LEADER_PROFILE_PORTRAITS.filter((option) => option.poolId === pool.id),
      }))
      .filter((group) => group.portraits.length > 0);
  }, [portrait.poolId]);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const panelStyle = useMemo(() => {
    if (!anchor || typeof window === "undefined") return undefined;
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const width = Math.min(PANEL_WIDTH, Math.max(0, viewportWidth - PANEL_MARGIN * 2));
    const maxHeight = Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, viewportHeight - PANEL_MARGIN * 2));
    const left = Math.min(
      Math.max(PANEL_MARGIN, anchor.left),
      Math.max(PANEL_MARGIN, viewportWidth - width - PANEL_MARGIN),
    );
    const top = Math.min(
      Math.max(PANEL_MARGIN, anchor.bottom + PANEL_GAP),
      Math.max(PANEL_MARGIN, viewportHeight - maxHeight - PANEL_MARGIN),
    );
    return { left, top, width, maxHeight } satisfies CSSProperties;
  }, [anchor]);

  async function selectPortrait(next: LeaderProfilePortrait) {
    if (next.id === portrait.id) return;
    setSavingId(next.id);
    setError("");
    try {
      const response = await api.updateLeaderProfilePortrait(sessionId, next.id);
      updateSdkSession(sessionId, {
        leaderProfilePortraitId: response.leaderProfilePortraitId,
        leaderProfilePortrait: response.leaderProfilePortrait,
      });
      setOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingId(null);
    }
  }

  function openPanel(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (triggerRef.current) setAnchor(triggerRef.current.getBoundingClientRect());
    setOpen(true);
  }

  const triggerSize = size === "lg" ? "h-9 w-9" : size === "md" ? "h-7 w-7" : "h-5 w-5";

  return (
    <>
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
        aria-label={`Open ${portrait.label} profile`}
        title="Leader profile"
        onClick={openPanel}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          if (triggerRef.current) setAnchor(triggerRef.current.getBoundingClientRect());
          setOpen(true);
        }}
        className={`inline-flex ${triggerSize} shrink-0 items-center justify-center rounded-full ring-1 ring-cc-border/70 transition hover:ring-cc-primary/60 focus:outline-none focus:ring-2 focus:ring-cc-primary/60`}
      >
        <img src={portrait.smallUrl} alt="" className="h-full w-full rounded-full object-cover" draggable={false} />
      </span>
      {open && panelStyle
        ? createPortal(
            <div
              className="fixed inset-0 z-[100]"
              onClick={() => setOpen(false)}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div
                role="dialog"
                aria-label="Leader profile"
                className="absolute flex flex-col overflow-hidden rounded-xl border border-cc-border bg-cc-card p-3 shadow-xl"
                style={panelStyle}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex shrink-0 items-start gap-3">
                  <img
                    src={portrait.largeUrl}
                    alt={portrait.label}
                    className="h-20 w-20 rounded-full object-cover ring-1 ring-cc-border/80"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-cc-fg">{portrait.label}</div>
                    <div className="text-xs text-cc-muted capitalize">{portrait.poolId} profile</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-md px-2 py-1 text-xs text-cc-muted transition hover:bg-cc-hover hover:text-cc-fg"
                  >
                    Close
                  </button>
                </div>
                <div data-testid="leader-profile-portrait-grid-scroll" className="mt-3 min-h-0 overflow-y-auto pr-1">
                  <div className="space-y-3">
                    {portraitGroups.map(({ pool, portraits }) => (
                      <section key={pool.id} aria-labelledby={`leader-profile-pool-${pool.id}`}>
                        <div
                          id={`leader-profile-pool-${pool.id}`}
                          className="mb-1.5 text-xs font-semibold text-cc-muted"
                        >
                          {pool.label}
                        </div>
                        <div className="grid grid-cols-6 gap-1.5">
                          {portraits.map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              disabled={savingId !== null}
                              onClick={() => selectPortrait(option)}
                              className={`rounded-full p-0.5 transition ${
                                option.id === portrait.id
                                  ? "ring-2 ring-cc-primary"
                                  : "ring-1 ring-cc-border/70 hover:ring-cc-primary/70"
                              } ${savingId === option.id ? "opacity-60" : ""}`}
                              title={option.label}
                            >
                              <img
                                src={option.smallUrl}
                                alt={option.label}
                                className="h-9 w-9 rounded-full object-cover"
                              />
                            </button>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
                {error && (
                  <div className="mt-3 shrink-0 rounded-lg bg-cc-error/10 px-3 py-2 text-xs text-cc-error">{error}</div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
