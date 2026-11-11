import { useEffect } from "react";
import { useStore } from "../store.js";
import { getTreeGroupNewSessionDefaultsKey } from "../utils/new-session-defaults.js";
import { navigateToMostRecentSession } from "../utils/routing.js";

/**
 * Painting of Tako, the cat in the Takode logo, curled up asleep, in the style of the leader
 * portraits. Shown where there is nothing yet: an empty conversation and the no-sessions page.
 * Size it with h-/w- classes; the image is 320px square, enough for 128px at 2.5x.
 */
export function SleepingTako({ className }: { className: string }) {
  return (
    <img
      src="/empty-state/sleeping-tako.v1.320.webp"
      alt=""
      draggable={false}
      className={`shrink-0 select-none rounded-full shadow-[0_6px_24px_rgba(0,0,0,0.18)] ring-1 ring-cc-border ${className}`}
    />
  );
}

export function EmptyState() {
  const serverName = useStore((s) => s.serverName);
  const sdkSessions = useStore((s) => s.sdkSessions);

  // Auto-navigate once sessions load (handles cold-start race where
  // sdkSessions is empty on mount but gets populated by Sidebar poll)
  useEffect(() => {
    if (sdkSessions.some((s) => !s.archived && !s.cronJobId)) {
      navigateToMostRecentSession({ replace: true });
    }
  }, [sdkSessions]);

  return (
    <div className="flex-1 h-full flex flex-col items-center justify-center px-4">
      <SleepingTako className="mb-4 h-32 w-32" />
      <h1 className="text-lg font-semibold text-cc-fg mb-1">{serverName || "Takode"}</h1>
      <p className="text-sm text-cc-muted mb-6">No active sessions</p>
      <button
        onClick={() =>
          useStore.getState().openNewSessionModal({
            treeGroupId: "default",
            newSessionDefaultsKey: getTreeGroupNewSessionDefaultsKey("default"),
          })
        }
        className="px-4 py-2.5 text-sm font-medium rounded-xl bg-cc-primary hover:bg-cc-primary-hover text-white transition-colors cursor-pointer flex items-center gap-2"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
          <path d="M8 3v10M3 8h10" />
        </svg>
        New Session in Default Session Space
      </button>
    </div>
  );
}
