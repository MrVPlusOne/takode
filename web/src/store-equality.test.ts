import { describe, expect, it } from "vitest";
import type { SdkSessionInfo } from "./types.js";
import { sdkSessionListEqual } from "./store-equality.js";

function session(overrides: Partial<SdkSessionInfo> = {}): SdkSessionInfo {
  return {
    sessionId: "s1",
    state: "connected",
    cwd: "/repo",
    createdAt: 1,
    ...overrides,
  };
}

describe("sdkSessionListEqual", () => {
  it("detects launch configuration changes used by Configure Session", () => {
    expect(sdkSessionListEqual([session({ codexMaxContextLength: 600_000 })], [session()])).toBe(false);
    expect(sdkSessionListEqual([session({ claudeMaxContextLength: 1_000_000 })], [session()])).toBe(false);
    expect(
      sdkSessionListEqual([session({ codexInternetAccess: true })], [session({ codexInternetAccess: false })]),
    ).toBe(false);
    expect(sdkSessionListEqual([session({ claudeReasoningEffort: "max" })], [session()])).toBe(false);
  });
});
