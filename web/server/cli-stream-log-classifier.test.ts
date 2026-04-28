import { describe, expect, it } from "vitest";
import {
  classifyCliStreamLogLevel,
  isCodexRefreshTokenReusedNoise,
  maybeFormatCodexTokenRefreshLogLine,
  type CodexTokenRefreshNoiseState,
} from "./cli-stream-log-classifier.js";

describe("CLI stream log classification", () => {
  it("classifies known Codex wrapper diagnostics as info", () => {
    // Wrapper launch diagnostics are expected stderr chatter, not session failures.
    expect(classifyCliStreamLogLevel("stderr", "[mai-codex-wrapper] execing codex_bin=/opt/homebrew/bin/codex\n")).toBe(
      "info",
    );
  });

  it("classifies known Codex refresh-token reuse noise as warn", () => {
    // Token reuse is still worth surfacing, but it should not flood ERROR logs when
    // sessions continue running with fresh shared auth.
    const line =
      "\u001b[31mERROR\u001b[0m codex_login::auth::manager: Failed to refresh token: " +
      "Your access token could not be refreshed because your refresh token was already used.";

    expect(isCodexRefreshTokenReusedNoise(line)).toBe(true);
    expect(classifyCliStreamLogLevel("stderr", line)).toBe("warn");
  });

  it("keeps auth-degraded feature failures as errors", () => {
    // Feature failures from expired auth remain actionable and should stay ERROR.
    const line =
      "ERROR rmcp::transport::worker: worker quit with fatal: Provided authentication token is expired. Please try signing in again.";

    expect(classifyCliStreamLogLevel("stderr", line)).toBe("error");
  });

  it("does not demote mixed stderr chunks that include an actionable failure", () => {
    // Stream chunks can contain more than one line, so a real failure must win
    // over adjacent known refresh-token noise in the same decoded chunk.
    const chunk = [
      "codex_login::auth::manager: Failed to refresh token: refresh token was already used",
      "ERROR rmcp::transport::worker: worker quit with fatal: Provided authentication token is expired.",
    ].join("\n");

    expect(classifyCliStreamLogLevel("stderr", chunk)).toBe("error");
  });

  it("rate-limits repeated Codex refresh-token reuse lines per session", () => {
    // Repeated refresh noise is summarized per session so one noisy process cannot
    // dominate the server log tail.
    const state = new Map<string, CodexTokenRefreshNoiseState>();

    expect(maybeFormatCodexTokenRefreshLogLine(state, "s1", "first", 1_000, 60_000)).toBe("first");
    expect(maybeFormatCodexTokenRefreshLogLine(state, "s1", "second", 2_000, 60_000)).toBeNull();
    expect(maybeFormatCodexTokenRefreshLogLine(state, "s1", "third", 3_000, 60_000)).toBeNull();
    expect(maybeFormatCodexTokenRefreshLogLine(state, "s1", "later", 62_000, 60_000)).toBe(
      "[suppressed 2 repeated Codex token refresh stderr line(s)] later",
    );
  });
});
