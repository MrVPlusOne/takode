import { useEffect, useRef } from "react";
import { useStore } from "../store.js";
import { GitHubPRSection, McpCollapsible, ClaudeMdCollapsible } from "./TaskPanel.js";

export function SessionInfoPopover({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const session = useStore((s) => s.sessions.get(sessionId));
  const sdkSession = useStore((s) => s.sdkSessions.find((x) => x.sessionId === sessionId));
  const cwd = session?.cwd || sdkSession?.cwd || null;
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid catching the click that opened the popover
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      className="fixed right-2 z-50 w-[300px] max-h-[80dvh] flex flex-col bg-cc-card border border-cc-border rounded-xl shadow-xl overflow-hidden"
      style={{ top: "calc(2.75rem + 8px)" }}
    >
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-cc-border">
        <span className="text-[12px] font-semibold text-cc-fg">Session Info</span>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-5 h-5 rounded-md text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <GitHubPRSection sessionId={sessionId} />
        <McpCollapsible sessionId={sessionId} />
        {cwd && <ClaudeMdCollapsible cwd={cwd} />}
      </div>
    </div>
  );
}
