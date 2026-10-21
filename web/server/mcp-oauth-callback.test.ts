import { afterEach, describe, expect, it } from "vitest";
import { deliverMcpOAuthCallback, mcpOAuthCallbackProblem, mcpOAuthRedirectUri } from "./mcp-oauth-callback.js";

describe("MCP sign-in callback checks", () => {
  const redirect = "http://127.0.0.1:41234/callback/abc";

  it("reads the registered callback from Codex's authorization URL", () => {
    expect(mcpOAuthRedirectUri(`https://a.example/authorize?redirect_uri=${encodeURIComponent(redirect)}`)).toBe(
      redirect,
    );
    expect(mcpOAuthRedirectUri("not a url")).toBeUndefined();
  });

  // Takode opens the pasted address on the session's machine, so anything but
  // the pending sign-in's own loopback callback must be refused.
  it("accepts only the registered loopback callback carrying the provider's answer", () => {
    expect(mcpOAuthCallbackProblem(`${redirect}?code=c&state=s`, redirect)).toBeUndefined();
    expect(mcpOAuthCallbackProblem(`${redirect}?error=access_denied`, redirect)).toBeUndefined();
    expect(mcpOAuthCallbackProblem("http://localhost:41234/callback/abc?code=c", redirect)).toBeUndefined();
    for (const pasted of [
      "nonsense",
      "https://127.0.0.1:41234/callback/abc?code=c",
      "http://10.0.0.2:41234/callback/abc?code=c",
      `${redirect}`,
      "http://127.0.0.1:9999/callback/abc?code=c",
      "http://127.0.0.1:41234/other?code=c",
    ]) {
      expect(mcpOAuthCallbackProblem(pasted, redirect)).toEqual(expect.any(String));
    }
  });
});

describe("deliverMcpOAuthCallback", () => {
  let server: ReturnType<typeof Bun.serve> | undefined;
  afterEach(() => server?.stop(true));

  it("opens a loopback callback and returns its status, and refuses other addresses", async () => {
    const seen: string[] = [];
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        seen.push(new URL(request.url).search);
        return new Response("signed in");
      },
    });
    expect(await deliverMcpOAuthCallback(`http://127.0.0.1:${server.port}/callback?code=c`)).toBe(200);
    expect(seen).toEqual(["?code=c"]);
    await expect(deliverMcpOAuthCallback("https://example.com/callback?code=c")).rejects.toThrow("loopback");
  });
});
