import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

const OverlayHeightContext = createContext(0);
const ReportOverlayHeightContext = createContext<((height: number) => void) | null>(null);
const EdgeCoveredContext = createContext(false);
const CoverEdgeContext = createContext<((delta: number) => void) | null>(null);
const HIDDEN: CSSProperties = { opacity: 0, pointerEvents: "none" };

/** Share local composer geometry with its conversation, independently of session state. */
export function ComposerFeedLayout({ children }: { children: ReactNode }) {
  const [height, setHeight] = useState(0);
  const [covers, setCovers] = useState(0);
  const [cover] = useState(() => (delta: number) => setCovers((count) => count + delta));
  return (
    <ReportOverlayHeightContext.Provider value={setHeight}>
      <OverlayHeightContext.Provider value={height}>
        <CoverEdgeContext.Provider value={cover}>
          <EdgeCoveredContext.Provider value={covers > 0}>
            <div className="relative flex flex-col h-full min-h-0">{children}</div>
          </EdgeCoveredContext.Provider>
        </CoverEdgeContext.Provider>
      </OverlayHeightContext.Provider>
    </ReportOverlayHeightContext.Provider>
  );
}

/** Measure only the part outside the reserved dock; in-flow touch layouts contribute nothing. */
export function useComposerOverlayMeasurement(root: RefObject<HTMLDivElement | null>, overlay: boolean) {
  const reportHeight = useContext(ReportOverlayHeightContext);
  useLayoutEffect(() => {
    const boundary = root.current;
    const dock = boundary?.parentElement;
    if (!overlay || !boundary || !dock || !reportHeight) return;
    // offsetHeight stays in layout pixels even when the app uses CSS zoom.
    const measure = () => reportHeight(Math.max(0, boundary.offsetHeight - dock.offsetHeight));
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(boundary);
    observer?.observe(dock);
    return () => {
      observer?.disconnect();
      reportHeight(0);
    };
  }, [overlay, reportHeight, root]);
}

/**
 * Lift for controls floating at the feed's bottom edge: an expanded desktop composer covers
 * that edge, which would hide them. Zero while the composer stays inside its dock. They are
 * hidden while a composer popup covers that edge (`useComposerCoversFeedEdge`).
 */
export function useComposerOverlayLift(): CSSProperties | undefined {
  const height = useContext(OverlayHeightContext);
  const covered = useContext(EdgeCoveredContext);
  if (height <= 0 && !covered) return undefined;
  return { ...(height > 0 ? { transform: `translateY(-${height}px)` } : {}), ...(covered ? HIDDEN : {}) };
}

/**
 * While `active`, a popup the composer opens over the feed's bottom edge (such as a comment's preview)
 * hides the controls floating there, which it would otherwise cut through.
 */
export function useComposerCoversFeedEdge(active: boolean) {
  const cover = useContext(CoverEdgeContext);
  useEffect(() => {
    if (!active || !cover) return;
    cover(1);
    return () => cover(-1);
  }, [active, cover]);
}

/** Keep one measured maximum per viewed destination so collapse cannot clamp a manual scroll. */
export function useComposerScrollSpace(scope: string) {
  const height = useContext(OverlayHeightContext);
  const [reservation, setReservation] = useState({ scope, height });
  const reservedHeight = reservation.scope === scope ? Math.max(reservation.height, height) : height;
  if (reservation.scope !== scope || reservation.height !== reservedHeight) {
    setReservation({ scope, height: reservedHeight });
  }
  return reservedHeight;
}
