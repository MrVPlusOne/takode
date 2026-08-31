export const BACKEND_CONNECTION_OPEN_EVENT = "takode:backend-connection-open";

export type BuildCompatibilityStatus = "unknown" | "compatible" | "reload-required" | "restart-required";
export type BuildCompatibilityReason =
  | "loaded-frontend-outdated"
  | "backend-identity-unavailable"
  | "served-frontend-identity-unavailable"
  | "server-pair-mismatch"
  | null;

export interface BuildCompatibilitySnapshot {
  /** Identity embedded in the JavaScript document that is currently running. */
  frontendBuildId: string | null;
  /** Identity asserted by the backend process. */
  backendBuildId: string | null;
  /** Identity in the manifest of the immutable frontend root served by that backend. */
  servedFrontendBuildId: string | null;
  status: BuildCompatibilityStatus;
  reason: BuildCompatibilityReason;
}

function normalizeBuildId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

const frontendBuildId = normalizeBuildId(typeof __TAKODE_BUILD_ID__ === "string" ? __TAKODE_BUILD_ID__ : null);

let snapshot: BuildCompatibilitySnapshot = {
  frontendBuildId,
  backendBuildId: null,
  servedFrontendBuildId: null,
  status: "unknown",
  reason: null,
};
const listeners = new Set<() => void>();
let nextObservationSequence = 0;
let latestAppliedObservationSequence = 0;

function publish(next: BuildCompatibilitySnapshot): void {
  if (
    snapshot.frontendBuildId === next.frontendBuildId &&
    snapshot.backendBuildId === next.backendBuildId &&
    snapshot.servedFrontendBuildId === next.servedFrontendBuildId &&
    snapshot.status === next.status &&
    snapshot.reason === next.reason
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) listener();
}

export function classifyBuildCompatibility(
  loadedFrontendValue: unknown,
  backendValue: unknown,
  servedFrontendValue: unknown,
): BuildCompatibilitySnapshot {
  const loadedFrontendBuildId = normalizeBuildId(loadedFrontendValue);
  const backendBuildId = normalizeBuildId(backendValue);
  const servedFrontendBuildId = normalizeBuildId(servedFrontendValue);

  if (
    loadedFrontendBuildId !== null &&
    loadedFrontendBuildId === backendBuildId &&
    backendBuildId === servedFrontendBuildId
  ) {
    return {
      frontendBuildId: loadedFrontendBuildId,
      backendBuildId,
      servedFrontendBuildId,
      status: "compatible",
      reason: null,
    };
  }

  if (backendBuildId !== null && backendBuildId === servedFrontendBuildId) {
    return {
      frontendBuildId: loadedFrontendBuildId,
      backendBuildId,
      servedFrontendBuildId,
      status: "reload-required",
      reason: "loaded-frontend-outdated",
    };
  }

  const reason: Exclude<BuildCompatibilityReason, "loaded-frontend-outdated" | null> =
    backendBuildId === null
      ? "backend-identity-unavailable"
      : servedFrontendBuildId === null
        ? "served-frontend-identity-unavailable"
        : "server-pair-mismatch";
  return {
    frontendBuildId: loadedFrontendBuildId,
    backendBuildId,
    servedFrontendBuildId,
    status: "restart-required",
    reason,
  };
}

/**
 * Allocates an ordering token before an asynchronous server identity probe.
 * Responses may resolve out of order across health polling, reconnects, and
 * Restart Server readiness checks, so only a token newer than the last applied
 * observation may replace the current compatibility diagnosis.
 */
export function beginBuildIdentityObservation(): number {
  nextObservationSequence += 1;
  return nextObservationSequence;
}

/**
 * Compares the loaded document with the backend process and the immutable
 * frontend root that backend is currently serving.
 *
 * The observation token must be allocated before the corresponding request.
 * This rejects stale responses without latching any compatibility state: newer
 * authoritative evidence may move among compatible, Reload, and full-restart
 * diagnoses as the server pair changes.
 */
export function observeServerBuildIdentity(
  backendValue: unknown,
  servedFrontendValue: unknown,
  observationSequence: number,
): BuildCompatibilitySnapshot {
  if (observationSequence < latestAppliedObservationSequence) return snapshot;
  latestAppliedObservationSequence = observationSequence;
  publish(classifyBuildCompatibility(frontendBuildId, backendValue, servedFrontendValue));
  return snapshot;
}

export function getBuildCompatibilitySnapshot(): BuildCompatibilitySnapshot {
  return snapshot;
}

export function subscribeBuildCompatibility(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Signals that a browser WebSocket opened and the app should re-check the server identity. */
export function announceBackendConnectionOpen(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(BACKEND_CONNECTION_OPEN_EVENT));
}

export function resetBuildCompatibilityForTest(): void {
  nextObservationSequence = 0;
  latestAppliedObservationSequence = 0;
  publish({
    frontendBuildId,
    backendBuildId: null,
    servedFrontendBuildId: null,
    status: "unknown",
    reason: null,
  });
}
