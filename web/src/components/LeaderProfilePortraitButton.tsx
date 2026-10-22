import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "../api.js";
import { useStore } from "../store.js";
import { useDesktopShellLayout } from "../hooks/useDesktopShellLayout.js";
import type { LeaderProfilePortrait } from "../../shared/leader-profile-portraits.js";
import { LEADER_PROFILE_POOLS, LEADER_PROFILE_PORTRAITS } from "../../shared/leader-profile-portraits.js";

const PANEL_MARGIN = 12;
const PANEL_GAP = 8;
const PANEL_MIN_HEIGHT = 180;
// Desktop has room for a wider panel with bigger thumbnails, which makes faces easier to tell apart.
const PANEL_SIZES = {
  phone: { width: 300, maxHeight: 520, gridClass: "grid-cols-6 gap-1.5", thumbClass: "h-9 w-9" },
  desktop: { width: 520, maxHeight: 760, gridClass: "grid-cols-8 gap-2", thumbClass: "h-12 w-12" },
} as const;

const PORTRAIT_SIZE_CLASS = {
  sm: "h-5 w-5",
  lg: "h-[1.8rem] w-[1.8rem]",
  sidebar: "h-[1.8rem] w-[1.8rem] sm:h-[2.25rem] sm:w-[2.25rem]",
} as const;

interface LeaderProfilePortraitImageProps {
  portrait: LeaderProfilePortrait;
  /** `sidebar` is `lg` on phones and a quarter wider on desktop, where leader cards have room for it. */
  size?: "sm" | "lg" | "sidebar";
  statusRing?: {
    className: string;
    status: string;
    style?: CSSProperties;
  };
  /** Small status marker drawn on the portrait's bottom-right corner; it brings its own outline. */
  cornerBadge?: ReactNode;
  testId?: string;
}

/**
 * A leader's round portrait, for display only. Clicks pass through to whatever contains it, so a
 * sidebar row opens its session when the portrait is tapped.
 */
export function LeaderProfilePortraitImage({
  portrait,
  size = "sm",
  statusRing,
  cornerBadge,
  testId,
}: LeaderProfilePortraitImageProps) {
  const sizeClass = PORTRAIT_SIZE_CLASS[size];
  const ringClass = statusRing?.className ?? "ring-1 ring-cc-border/70";
  return (
    <span
      className={`relative inline-flex ${sizeClass} shrink-0 items-center justify-center rounded-full ${ringClass}`}
      data-testid={testId}
      data-status={statusRing?.status}
      style={statusRing?.style}
    >
      <img
        src={portrait.smallUrl}
        alt=""
        width={portrait.smallSize}
        height={portrait.smallSize}
        loading="eager"
        decoding="async"
        className="h-full w-full rounded-full object-cover"
        draggable={false}
      />
      {cornerBadge && <span className="absolute -bottom-px -right-px flex">{cornerBadge}</span>}
    </span>
  );
}

interface LeaderProfilePortraitButtonProps {
  sessionId: string;
  portrait: LeaderProfilePortrait;
  ariaLabel: string;
  title?: string;
  className?: string;
  /** Shown after the portrait inside the button, such as the portrait's name. */
  children?: ReactNode;
}

/**
 * The only way to change a leader's portrait: a button showing the portrait that opens the picker.
 * It lives in Session Info; elsewhere portraits are display-only so a stray tap can't open the picker.
 */
export function LeaderProfilePortraitButton({
  sessionId,
  portrait,
  ariaLabel,
  title,
  className,
  children,
}: LeaderProfilePortraitButtonProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const updateSdkSession = useStore((state) => state.updateSdkSession);
  const collapsedPools = useStore((state) => state.leaderProfileCollapsedPools);
  const setPoolCollapsed = useStore((state) => state.setLeaderProfilePoolCollapsed);
  const sizes = useDesktopShellLayout() ? PANEL_SIZES.desktop : PANEL_SIZES.phone;
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
    const width = Math.min(sizes.width, Math.max(0, viewportWidth - PANEL_MARGIN * 2));
    const maxHeight = Math.min(sizes.maxHeight, Math.max(PANEL_MIN_HEIGHT, viewportHeight - PANEL_MARGIN * 2));
    const left = Math.min(
      Math.max(PANEL_MARGIN, anchor.left),
      Math.max(PANEL_MARGIN, viewportWidth - width - PANEL_MARGIN),
    );
    const top = Math.min(
      Math.max(PANEL_MARGIN, anchor.bottom + PANEL_GAP),
      Math.max(PANEL_MARGIN, viewportHeight - maxHeight - PANEL_MARGIN),
    );
    return { left, top, width, maxHeight } satisfies CSSProperties;
  }, [anchor, sizes]);

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

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        title={title}
        onClick={openPanel}
        className={className}
      >
        <LeaderProfilePortraitImage portrait={portrait} size="lg" />
        {children}
      </button>
      {open && panelStyle
        ? createPortal(
            <div
              className="fixed inset-0 z-[100]"
              data-leader-profile-portrait-picker="true"
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
                    width={portrait.largeSize}
                    height={portrait.largeSize}
                    loading="eager"
                    decoding="async"
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
                    {portraitGroups.map(({ pool, portraits }) => {
                      const collapsed = collapsedPools.includes(pool.id);
                      return (
                        <section key={pool.id} aria-labelledby={`leader-profile-pool-${pool.id}`}>
                          <button
                            type="button"
                            aria-expanded={!collapsed}
                            aria-controls={`leader-profile-pool-grid-${pool.id}`}
                            onClick={() => setPoolCollapsed(pool.id, !collapsed)}
                            className="mb-1.5 flex w-full items-center gap-1.5 rounded-md py-0.5 text-left text-xs font-semibold text-cc-muted transition hover:text-cc-fg"
                          >
                            <Chevron open={!collapsed} />
                            <span id={`leader-profile-pool-${pool.id}`}>{pool.label}</span>
                          </button>
                          {!collapsed && (
                            <div
                              id={`leader-profile-pool-grid-${pool.id}`}
                              className={`grid justify-items-center ${sizes.gridClass}`}
                            >
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
                                    width={option.smallSize}
                                    height={option.smallSize}
                                    loading="lazy"
                                    decoding="async"
                                    className={`${sizes.thumbClass} rounded-full object-cover`}
                                  />
                                </button>
                              ))}
                            </div>
                          )}
                        </section>
                      );
                    })}
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

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden="true"
      className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
