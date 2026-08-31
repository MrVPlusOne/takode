import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  getBuildCompatibilitySnapshot,
  subscribeBuildCompatibility,
  type BuildCompatibilityReason,
  type BuildCompatibilitySnapshot,
} from "../build-compatibility.js";

function reloadPage(): void {
  window.location.reload();
}

function unavailableLabel(value: string | null): string {
  return value ?? "unavailable";
}

function restartDiagnostic(reason: BuildCompatibilityReason): string {
  if (reason === "backend-identity-unavailable") {
    return "The running backend has no build identity, so Reload cannot verify or restore a compatible pair. Fully stop and start Takode from the launcher or service that started it.";
  }
  if (reason === "served-frontend-identity-unavailable") {
    return "The running server cannot identify the frontend snapshot it is serving. Reload cannot repair this server state. Fully stop and start Takode from the launcher or service that started it.";
  }
  return "The running backend and the frontend snapshot it serves have different build identities. Reload cannot repair this server state. Fully stop and start Takode from the launcher or service that started it.";
}

export function BuildMismatchNotice({
  compatibility,
  placement = "fixed",
  onReload = reloadPage,
}: {
  compatibility: BuildCompatibilitySnapshot;
  placement?: "fixed" | "inline";
  onReload?: () => void;
}) {
  const reloadRequired = compatibility.status === "reload-required";
  const shellClass = placement === "fixed" ? "fixed inset-x-2 top-2 z-[90] mx-auto max-w-3xl shadow-xl" : "w-full";

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-label={reloadRequired ? "Frontend update required" : "Takode restart required"}
      data-testid="build-mismatch-notice"
      data-compatibility-status={compatibility.status}
      className={`${shellClass} rounded-lg border border-cc-warning/40 bg-cc-card px-3 py-2 text-cc-fg`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-cc-warning">{reloadRequired ? "Reload Takode" : "Restart Takode"}</p>
          <p className="mt-0.5 text-xs leading-5 text-cc-muted">
            {reloadRequired
              ? "A compatible frontend is ready on the server. Reload to use the matching interface."
              : restartDiagnostic(compatibility.reason)}
          </p>
          <details className="mt-1 text-[11px] leading-4 text-cc-muted">
            <summary className="w-fit cursor-pointer select-none">Build details</summary>
            <dl className="mt-1 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-2 font-mono">
              <dt>Loaded</dt>
              <dd className="break-all">{unavailableLabel(compatibility.frontendBuildId)}</dd>
              <dt>Served</dt>
              <dd className="break-all">{unavailableLabel(compatibility.servedFrontendBuildId)}</dd>
              <dt>Backend</dt>
              <dd className="break-all">{unavailableLabel(compatibility.backendBuildId)}</dd>
            </dl>
          </details>
        </div>
        {reloadRequired && (
          <button
            type="button"
            onClick={onReload}
            className="shrink-0 self-start rounded-md bg-cc-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cc-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-accent sm:self-center"
          >
            Reload
          </button>
        )}
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
  if (
    (compatibility.status !== "reload-required" && compatibility.status !== "restart-required") ||
    typeof document === "undefined"
  ) {
    return null;
  }
  return createPortal(<BuildMismatchNotice compatibility={compatibility} />, document.body);
}
