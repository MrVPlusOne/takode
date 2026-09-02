import type { BuildCompatibilitySnapshot } from "./build-compatibility.js";

export type InitiatingTabRestartDecision = "wait" | "reload" | "stop";

export interface RestartReadinessIdentity {
  buildId: string | null;
  servedFrontendBuildId: string | null;
}

export interface InitiatingTabRestartIntent {
  observe(readiness: RestartReadinessIdentity, compatibility: BuildCompatibilitySnapshot): InitiatingTabRestartDecision;
  cancel(): void;
}

/**
 * Keeps one successful production restart request local to the browser tab that
 * initiated it. The prepared build ID is unique to that restart candidate, so
 * another coherent server pair cannot consume stale intent from this attempt.
 */
export function createInitiatingTabRestartIntent(
  replacementBuildId: string,
  previousServerBuildId: string | null,
): InitiatingTabRestartIntent {
  const expectedBuildId = replacementBuildId.trim();
  const previousBuildId = previousServerBuildId?.trim() || null;
  let active = expectedBuildId.length > 0;

  return {
    observe(readiness, compatibility): InitiatingTabRestartDecision {
      if (!active) return "stop";

      const readinessMatchesReplacement =
        readiness.buildId === expectedBuildId && readiness.servedFrontendBuildId === expectedBuildId;
      const appliedSnapshotMatchesReplacement =
        compatibility.backendBuildId === expectedBuildId && compatibility.servedFrontendBuildId === expectedBuildId;

      if (readinessMatchesReplacement && appliedSnapshotMatchesReplacement) {
        active = false;
        return compatibility.status === "reload-required" ? "reload" : "stop";
      }

      // A newer health/reconnect probe may already see the replacement pair,
      // while this stale readiness response still belongs to the old server.
      // Wait for structural readiness from the exact replacement before reload.
      if (appliedSnapshotMatchesReplacement) return "wait";

      const appliedSnapshotMatchesPreviousPair =
        previousBuildId !== null &&
        compatibility.backendBuildId === previousBuildId &&
        compatibility.servedFrontendBuildId === previousBuildId;

      // The applied snapshot is the ordered authority. If a newer probe still
      // sees the captured predecessor, any different raw readiness result here
      // is stale and must not retire the pending replacement intent.
      if (appliedSnapshotMatchesPreviousPair) return "wait";

      // A broken server pair, a newer unrelated replacement, or an expected
      // response superseded by newer evidence must retain the manual diagnosis.
      active = false;
      return "stop";
    },
    cancel(): void {
      active = false;
    },
  };
}
