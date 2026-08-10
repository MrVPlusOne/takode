import { describe, expect, it } from "vitest";
import {
  getLiveSessionConnectionStatus,
  getRecoverableSessionConnectionPresentation,
} from "./recoverable-session-connection.js";

function classify(
  overrides: Partial<Parameters<typeof getRecoverableSessionConnectionPresentation>[0]> & {
    launcherState?: "starting" | "connected" | "running" | "exited";
    archived?: boolean;
  } = {},
) {
  const input = {
    backendState: "disconnected",
    browserConnectionStatus: "connected" as const,
    cliConnected: false,
    cliEverConnected: true,
    serverReachable: true,
    ...overrides,
  };
  const recoverableConnectionPresentation = getRecoverableSessionConnectionPresentation(input);
  return {
    recoverableConnectionPresentation,
    liveConnectionStatus: getLiveSessionConnectionStatus({
      ...input,
      recoverableConnectionPresentation,
      launcherState: overrides.launcherState,
      archived: overrides.archived,
    }),
  };
}

describe("session connection presentation", () => {
  it("keeps a historical post-restart disconnect on the quiet recoverable path", () => {
    // A durable launcher/session-list signal or a hydrated history window marks
    // this as a previously connected session. Passive viewing must not imply
    // that the exited backend is starting.
    const result = classify({ launcherState: "exited" });

    expect(result.recoverableConnectionPresentation).toMatchObject({
      kind: "disconnected",
      label: "Disconnected",
    });
    expect(result.liveConnectionStatus).toBeNull();
  });

  it("does not invent startup before authoritative launcher or history evidence arrives", () => {
    // A cold browser subscribe is passive. Missing local history cannot stand
    // in for an explicit server-owned starting or recovery state.
    const result = classify({ cliEverConnected: false, launcherState: undefined });

    expect(result.recoverableConnectionPresentation).toBeNull();
    expect(result.liveConnectionStatus).toBeNull();
  });

  it("preserves the genuine fresh-launch startup indicator", () => {
    const result = classify({ cliEverConnected: false, launcherState: "starting" });

    expect(result.recoverableConnectionPresentation).toBeNull();
    expect(result.liveConnectionStatus).toBe("starting");
  });

  it("preserves active initialization before the first backend connection", () => {
    const result = classify({
      backendState: "initializing",
      cliEverConnected: false,
      launcherState: "connected",
    });

    expect(result.recoverableConnectionPresentation).toBeNull();
    expect(result.liveConnectionStatus).toBe("starting");
  });

  it("presents real demand-driven recovery as unobtrusive reconnecting state", () => {
    const result = classify({ backendState: "recovering", launcherState: "connected" });

    expect(result.recoverableConnectionPresentation).toMatchObject({
      kind: "reconnecting",
      label: "Reconnecting",
    });
    expect(result.liveConnectionStatus).toBeNull();
  });

  it.each([
    ["broken", "broken"],
    ["recovery_suppressed", "recovery-suppressed"],
  ] as const)("keeps %s failures on the prominent %s path", (backendState, expected) => {
    const result = classify({ backendState, launcherState: "exited" });

    expect(result.recoverableConnectionPresentation).toBeNull();
    expect(result.liveConnectionStatus).toBe(expected);
  });

  it("keeps browser transport and server reachability failures distinct", () => {
    expect(classify({ browserConnectionStatus: "disconnected" }).liveConnectionStatus).toBe("websocket-disconnected");
    expect(classify({ serverReachable: false }).liveConnectionStatus).toBe("server-unreachable");
  });
});
