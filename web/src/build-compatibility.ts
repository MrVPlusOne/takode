export const BACKEND_CONNECTION_OPEN_EVENT = "takode:backend-connection-open";

export type BuildCompatibilityStatus = "unknown" | "compatible" | "mismatch";

export interface BuildCompatibilitySnapshot {
  frontendBuildId: string | null;
  backendBuildId: string | null;
  status: BuildCompatibilityStatus;
}

function normalizeBuildId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

const frontendBuildId = normalizeBuildId(typeof __TAKODE_BUILD_ID__ === "string" ? __TAKODE_BUILD_ID__ : null);

let snapshot: BuildCompatibilitySnapshot = {
  frontendBuildId,
  backendBuildId: null,
  status: "unknown",
};
const listeners = new Set<() => void>();

function publish(next: BuildCompatibilitySnapshot): void {
  if (
    snapshot.frontendBuildId === next.frontendBuildId &&
    snapshot.backendBuildId === next.backendBuildId &&
    snapshot.status === next.status
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) listener();
}

/**
 * Compares one server-authored build identity with this loaded frontend.
 *
 * A confirmed mismatch is latched for the life of the document so an older
 * in-flight response cannot hide the required Reload action. A successful
 * server response without a valid identity fails closed as incompatible.
 */
export function observeBackendBuildId(value: unknown): BuildCompatibilitySnapshot {
  const backendBuildId = normalizeBuildId(value);
  if (snapshot.status === "mismatch") return snapshot;

  publish({
    frontendBuildId,
    backendBuildId,
    status: frontendBuildId !== null && backendBuildId === frontendBuildId ? "compatible" : "mismatch",
  });
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
  publish({ frontendBuildId, backendBuildId: null, status: "unknown" });
}
