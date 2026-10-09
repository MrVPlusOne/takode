import { describe, expect, it } from "vitest";
import { inheritedLaunchEnv, parentClaudeSessionWarning } from "./cli-launcher-env.js";

/**
 * Variables Claude Desktop set for its agent's Bash tool when that agent
 * restarted a `takode node` (abridged from the observed environment). With
 * them, every Claude the node launched reported "Not logged in".
 */
const PARENT_DESKTOP_SESSION_ENV = {
  CLAUDECODE: "1",
  CLAUDE_CODE_ENTRYPOINT: "claude-desktop-3p",
  CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1",
  CLAUDE_CODE_HOST_AUTH_ENV_VAR: "ANTHROPIC_AUTH_TOKEN",
  ANTHROPIC_AUTH_TOKEN: "desktop-host-token",
  CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: "1",
  CLAUDE_CODE_SESSION_ID: "parent-session",
  CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/parent.sock",
  CLAUDE_CODE_MESSAGING_TOKEN: "parent-messaging-token",
  CLAUDE_PID: "1234",
  USE_LOCAL_OAUTH: "",
  AI_AGENT: "claude-code",
  CLAUDE_CODE_USE_VERTEX: "",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "",
};

describe("inheritedLaunchEnv", () => {
  it("drops a parent Claude Code session's variables and the login its host supplied", () => {
    const env = inheritedLaunchEnv({ ...PARENT_DESKTOP_SESSION_ENV, HOME: "/home/user", PATH: "/usr/bin" });
    expect(env).toEqual({ HOME: "/home/user", PATH: "/usr/bin" });
  });

  it("keeps provider settings a user set on purpose", () => {
    // Without the host-auth marker, ANTHROPIC_AUTH_TOKEN is the user's own
    // setting (e.g. from a wrapper script), as are the provider switches.
    const intended = {
      ANTHROPIC_BASE_URL: "https://proxy.example",
      ANTHROPIC_AUTH_TOKEN: "user-token",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_OAUTH_TOKEN: "user-oauth-token",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-5-5",
      DISABLE_TELEMETRY: "1",
    };
    expect(inheritedLaunchEnv(intended)).toEqual(intended);
  });

  it("drops OpenTelemetry settings meant for this process", () => {
    expect(inheritedLaunchEnv({ OTEL_SERVICE_NAME: "takode", KEEP: "1" })).toEqual({ KEEP: "1" });
  });
});

describe("parentClaudeSessionWarning", () => {
  it("names the parent session's variables", () => {
    const warning = parentClaudeSessionWarning({ CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", HOME: "/home/user" });
    expect(warning).toContain("CLAUDECODE, CLAUDE_CODE_ENTRYPOINT");
    expect(warning).not.toContain("HOME");
  });

  it("is null for a clean environment, including intended provider settings", () => {
    expect(parentClaudeSessionWarning({ HOME: "/home/user", ANTHROPIC_BASE_URL: "https://proxy.example" })).toBeNull();
  });
});
