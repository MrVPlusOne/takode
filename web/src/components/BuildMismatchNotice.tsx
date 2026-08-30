import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { getBuildCompatibilitySnapshot, subscribeBuildCompatibility } from "../build-compatibility.js";

function reloadPage(): void {
  window.location.reload();
}

export function BuildMismatchNotice({
  placement = "fixed",
  onReload = reloadPage,
}: {
  placement?: "fixed" | "inline";
  onReload?: () => void;
}) {
  const shellClass = placement === "fixed" ? "fixed inset-x-2 top-2 z-[90] mx-auto max-w-3xl shadow-xl" : "w-full";

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-label="Frontend update required"
      data-testid="build-mismatch-notice"
      className={`${shellClass} rounded-lg border border-cc-warning/40 bg-cc-card px-3 py-2 text-cc-fg`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-cc-warning">Reload Takode</p>
          <p className="mt-0.5 text-xs leading-5 text-cc-muted">
            This frontend is outdated or incompatible with the running server. Reload to use the matching interface.
          </p>
        </div>
        <button
          type="button"
          onClick={onReload}
          className="shrink-0 self-start rounded-md bg-cc-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cc-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-accent sm:self-center"
        >
          Reload
        </button>
      </div>
    </div>
  );
}

export function ActiveBuildMismatchNotice() {
  const compatibility = useSyncExternalStore(
    subscribeBuildCompatibility,
    getBuildCompatibilitySnapshot,
    getBuildCompatibilitySnapshot,
  );
  if (compatibility.status !== "mismatch" || typeof document === "undefined") return null;
  return createPortal(<BuildMismatchNotice />, document.body);
}
