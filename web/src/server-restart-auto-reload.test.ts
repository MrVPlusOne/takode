import { describe, expect, it } from "vitest";
import type { BuildCompatibilitySnapshot } from "./build-compatibility.js";
import { createInitiatingTabRestartIntent } from "./server-restart-auto-reload.js";

function compatibility(overrides: Partial<BuildCompatibilitySnapshot>): BuildCompatibilitySnapshot {
  return {
    frontendBuildId: "build-old",
    backendBuildId: "build-old",
    servedFrontendBuildId: "build-old",
    status: "compatible",
    reason: null,
    ...overrides,
  };
}

function readiness(buildId: string | null, servedFrontendBuildId: string | null = buildId) {
  return { buildId, servedFrontendBuildId };
}

describe("initiating-tab server restart intent", () => {
  it("waits through the old compatible pair, then reloads the exact prepared replacement once", () => {
    // The old server can still answer briefly after accepting the restart. It
    // must not consume the intent before the prepared build becomes ready.
    const intent = createInitiatingTabRestartIntent("build-target", "build-old");

    expect(intent.observe(readiness("build-old"), compatibility({}))).toBe("wait");
    const replacement = compatibility({
      backendBuildId: "build-target",
      servedFrontendBuildId: "build-target",
      status: "reload-required",
      reason: "loaded-frontend-outdated",
    });
    expect(intent.observe(readiness("build-target"), replacement)).toBe("reload");
    expect(intent.observe(readiness("build-target"), replacement)).toBe("stop");
  });

  it("waits through a pre-existing reload-required server pair captured before the request", () => {
    // The initiating document can already be older than the coherent server
    // pair. Correlation follows the captured server pair, not the loaded ID.
    const intent = createInitiatingTabRestartIntent("build-target", "build-current");
    const currentServer = compatibility({
      backendBuildId: "build-current",
      servedFrontendBuildId: "build-current",
      status: "reload-required",
      reason: "loaded-frontend-outdated",
    });
    const replacement = compatibility({
      backendBuildId: "build-target",
      servedFrontendBuildId: "build-target",
      status: "reload-required",
      reason: "loaded-frontend-outdated",
    });

    expect(intent.observe(readiness("build-current"), currentServer)).toBe("wait");
    expect(intent.observe(readiness("build-target"), replacement)).toBe("reload");
  });

  it("keeps waiting when a stale raw readiness result loses to the captured predecessor", () => {
    // Observation ordering can reject an older target-looking response after a
    // newer probe proves the predecessor is still current. Applied authority
    // must win without consuming the exact target intent.
    const intent = createInitiatingTabRestartIntent("build-target", "build-old");
    const predecessor = compatibility({});
    const replacement = compatibility({
      backendBuildId: "build-target",
      servedFrontendBuildId: "build-target",
      status: "reload-required",
      reason: "loaded-frontend-outdated",
    });

    expect(intent.observe(readiness("build-target"), predecessor)).toBe("wait");
    expect(intent.observe(readiness("build-stale"), predecessor)).toBe("wait");
    expect(intent.observe(readiness("build-target"), replacement)).toBe("reload");
  });

  it("waits for target readiness when a newer health probe already sees the replacement", () => {
    // Ordered compatibility can be newer than an old readiness response. Do
    // not combine those two different observations into premature reload proof.
    const intent = createInitiatingTabRestartIntent("build-target", "build-old");
    const replacement = compatibility({
      backendBuildId: "build-target",
      servedFrontendBuildId: "build-target",
      status: "reload-required",
      reason: "loaded-frontend-outdated",
    });

    expect(intent.observe(readiness("build-old"), replacement)).toBe("wait");
    expect(intent.observe(readiness("build-target"), replacement)).toBe("reload");
  });

  it("does not let a different coherent restart consume stale initiating-tab intent", () => {
    // A later unrelated restart has its own opaque build ID. The old intent is
    // retired instead of reloading for a server pair it did not initiate.
    const intent = createInitiatingTabRestartIntent("build-target", "build-old");
    const otherReplacement = compatibility({
      backendBuildId: "build-other",
      servedFrontendBuildId: "build-other",
      status: "reload-required",
      reason: "loaded-frontend-outdated",
    });

    expect(intent.observe(readiness("build-other"), otherReplacement)).toBe("stop");
    expect(
      intent.observe(
        readiness("build-target"),
        compatibility({
          backendBuildId: "build-target",
          servedFrontendBuildId: "build-target",
          status: "reload-required",
          reason: "loaded-frontend-outdated",
        }),
      ),
    ).toBe("stop");
  });

  it("rejects a stale target response after newer evidence shows another replacement", () => {
    // The readiness request may have started before a newer probe. The applied
    // snapshot remains authoritative even when the older raw response matches.
    const intent = createInitiatingTabRestartIntent("build-target", "build-old");

    expect(
      intent.observe(
        readiness("build-target"),
        compatibility({
          backendBuildId: "build-other",
          servedFrontendBuildId: "build-other",
          status: "reload-required",
          reason: "loaded-frontend-outdated",
        }),
      ),
    ).toBe("stop");
  });

  it("preserves a truthful restart-required diagnosis without reloading", () => {
    // Structural readiness is not compatibility: a mismatched server pair must
    // remain on the existing full-restart path even after an initiating click.
    const intent = createInitiatingTabRestartIntent("build-target", "build-old");
    const brokenPair = compatibility({
      backendBuildId: "build-target",
      servedFrontendBuildId: "build-stale",
      status: "restart-required",
      reason: "server-pair-mismatch",
    });

    expect(intent.observe(readiness("build-target", "build-stale"), brokenPair)).toBe("stop");
  });

  it("does not reload when the loaded document already matches the replacement", () => {
    // This is uncommon for production's fresh build IDs, but keeps the helper
    // safe if a matching document is restored before the readiness callback.
    const intent = createInitiatingTabRestartIntent("build-target", "build-old");
    const matchingDocument = compatibility({
      frontendBuildId: "build-target",
      backendBuildId: "build-target",
      servedFrontendBuildId: "build-target",
      status: "compatible",
    });

    expect(intent.observe(readiness("build-target"), matchingDocument)).toBe("stop");
  });

  it("cancels pending intent before a later observation can reload", () => {
    // Timeout, unmount, and explicit failure paths all cancel the same local
    // intent so a later unrelated readiness result cannot revive it.
    const intent = createInitiatingTabRestartIntent("build-target", "build-old");
    intent.cancel();

    expect(
      intent.observe(
        readiness("build-target"),
        compatibility({
          backendBuildId: "build-target",
          servedFrontendBuildId: "build-target",
          status: "reload-required",
          reason: "loaded-frontend-outdated",
        }),
      ),
    ).toBe("stop");
  });

  it("fails closed when the pre-request server pair was not known", () => {
    // Without a captured coherent old pair, a different ready pair cannot be
    // proven to be the still-running predecessor rather than another restart.
    const intent = createInitiatingTabRestartIntent("build-target", null);

    expect(intent.observe(readiness("build-old"), compatibility({}))).toBe("stop");
  });
});
