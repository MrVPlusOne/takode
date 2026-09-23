import { createContext, useContext, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";

const OverlayHeightContext = createContext(0);
const ReportOverlayHeightContext = createContext<((height: number) => void) | null>(null);

/** Share local composer geometry with its conversation, independently of session state. */
export function ComposerFeedLayout({ children }: { children: ReactNode }) {
  const [height, setHeight] = useState(0);
  return (
    <ReportOverlayHeightContext.Provider value={setHeight}>
      <OverlayHeightContext.Provider value={height}>
        <div className="relative flex flex-col h-full min-h-0">{children}</div>
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
