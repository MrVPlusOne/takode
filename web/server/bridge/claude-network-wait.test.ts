import { describe, expect, it } from "vitest";
import { isClaudeNetworkFailureText } from "./claude-network-wait.js";

// Claude Code words each failure to reach the model API differently. These are
// the messages its error formatter produces (2.1.289), plus the older wording
// seen from the 2.1.141 SDK binary. Only real connectivity failures may pause
// a turn; configuration and API errors must stay visible.
describe("isClaudeNetworkFailureText", () => {
  it.each([
    "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)",
    "API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)",
    "API Error: Connection dropped (ECONNRESET)",
    "API Error: No internet route — check your connection or VPN (ENETUNREACH)",
    "API Error: Connection lost while your computer was asleep",
    "API Error: Connection closed before the response finished",
    "API Error: No response from API",
    "API Error: Request timed out. Check your internet connection and proxy settings",
    "API Error: Unable to connect to API. Check your internet connection",
    "API Error: Unable to connect to API (ConnectionRefused)",
  ])("treats %s as a network failure", (text) => {
    expect(isClaudeNetworkFailureText(text)).toBe(true);
  });

  it.each([
    "API Error: Unable to connect to API: SSL certificate has expired",
    "API Error: Couldn't connect through your proxy (ERR_PROXY_TUNNEL) — the proxy refused the tunnel",
    "API Error: 401 authentication failed",
    "API Error: 429 rate limit exceeded",
    "Can't reach the API server — check your internet or DNS (ENOTFOUND)",
    undefined,
  ])("keeps %s visible", (text) => {
    expect(isClaudeNetworkFailureText(text)).toBe(false);
  });
});
