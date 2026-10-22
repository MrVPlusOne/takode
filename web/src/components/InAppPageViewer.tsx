import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { usePreviewSheetHistoryEntry } from "./quest-preview-sheet-history.js";

/**
 * The page's own sandbox minus popups and top navigation: either would take over the Home Screen
 * app again. The server adds its own CSP sandbox for HTML file links; the stricter of the two applies.
 */
const PAGE_SANDBOX =
  "allow-downloads allow-forms allow-modals allow-orientation-lock allow-pointer-lock allow-presentation allow-scripts";

interface InAppPage {
  url: string;
  label: string;
}

const useOpenPage = create<{ page: InAppPage | null }>(() => ({ page: null }));

/**
 * Whether Takode runs as an iPhone or iPad Home Screen app. Such an app has no tabs, address bar
 * or back button, so a page on Takode's own origin opened "in a new tab" replaces the whole app
 * and leaves no way back short of quitting it. Other origins open in iOS's own browser sheet.
 */
export function isIosHomeScreenApp(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Show a page from Takode's origin in a sheet above the app, with a Close button. */
export function openInAppPage(url: string, label: string): void {
  useOpenPage.setState({ page: { url, label } });
}

/**
 * Renders the in-app page viewer; mount once at the app root. In the iOS Home Screen app it also
 * routes every link that would open a Takode-origin page in a new tab (HTML file links, links in
 * messages, audio) to the viewer, so no link can strand the user outside Takode.
 */
export function InAppPageViewerHost() {
  const page = useOpenPage((state) => state.page);

  useEffect(() => {
    if (!isIosHomeScreenApp()) return;
    // Capture phase, so a link whose handler stops propagation is still caught.
    const handleClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.target !== "_blank") return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin) return;
      event.preventDefault();
      openInAppPage(url.href, link.title || link.textContent?.trim() || url.pathname);
    };
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  if (!page) return null;
  return <InAppPageViewer key={page.url} page={page} onClose={() => useOpenPage.setState({ page: null })} />;
}

function InAppPageViewer({ page, onClose }: { page: InAppPage; onClose: () => void }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  usePreviewSheetHistoryEntry(true, sheetRef, onClose);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const name = page.label.split(/[\\/]/).pop() || page.label;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-3 py-4"
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
      data-testid="in-app-page-viewer-backdrop"
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        className="flex h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-cc-border bg-cc-bg shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-cc-border bg-cc-card px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-cc-fg">{name}</div>
            {name !== page.label && <div className="break-all text-xs text-cc-muted">{page.label}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-cc-muted hover:bg-cc-hover hover:text-cc-fg transition-colors cursor-pointer"
            aria-label="Close page"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {/* Pages assume a white canvas, as in a browser tab. */}
        <iframe src={page.url} title={name} sandbox={PAGE_SANDBOX} className="min-h-0 w-full flex-1 bg-white" />
      </div>
    </div>,
    document.body,
  );
}
