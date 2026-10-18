import { describe, expect, it } from "vitest";
import { applySessionLaunchConfigPatch } from "./session-launch-config.js";
import { ensureModelAuthority } from "./cli-launcher-model-authority.js";
import { resolveModelAuthority } from "./model-identity-contract.js";
import type { SdkSessionInfo } from "./session-info.js";

function codexSession(overrides: Partial<SdkSessionInfo> = {}): SdkSessionInfo {
  return {
    sessionId: "s1",
    backendType: "codex",
    model: "gpt-5.4",
    modelAuthority: resolveModelAuthority([{ source: "session_default", model: "gpt-5.4", precedence: 300 }]),
    state: "connected",
    cwd: "/repo",
    createdAt: 0,
    ...overrides,
  } as SdkSessionInfo;
}

describe("applySessionLaunchConfigPatch", () => {
  it("keeps a Codex model chosen in Configure Session across relaunch", () => {
    // Relaunch trusts the model only when its authority names the same model. A
    // model changed without its authority used to be replaced by the configured
    // default (or an earlier migration) on the next relaunch.
    const info = codexSession();

    expect(applySessionLaunchConfigPatch(info, { model: "gpt-5.6-terra" })).toBe(true);
    expect(info.modelAuthority).toMatchObject({ model: "gpt-5.6-terra", source: "explicit_request" });

    const relaunch = ensureModelAuthority(info, "gpt-5.5", "legacy_relaunch");
    expect(relaunch.migrationCreated).toBe(false);
    expect(info.model).toBe("gpt-5.6-terra");
  });

  it("leaves the authority alone when the Codex model does not change or the session is not Codex", () => {
    const codex = codexSession();
    const authority = codex.modelAuthority;
    applySessionLaunchConfigPatch(codex, { model: "gpt-5.4", codexReasoningEffort: "high" });
    expect(codex.modelAuthority).toBe(authority);

    const claude = codexSession({ backendType: "claude-sdk", modelAuthority: undefined });
    applySessionLaunchConfigPatch(claude, { model: "opus" });
    expect(claude.modelAuthority).toBeUndefined();
  });

  it("rejects an invalid Codex model id without changing the session", () => {
    const info = codexSession();
    expect(() => applySessionLaunchConfigPatch(info, { model: "Not A Model", codexReasoningEffort: "high" })).toThrow();
    expect(info.model).toBe("gpt-5.4");
    expect(info.codexReasoningEffort).toBeUndefined();
  });
});
