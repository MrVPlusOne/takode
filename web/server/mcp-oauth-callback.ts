import { requestOnHost } from "./remote-host/session-machine.js";

/**
 * MCP OAuth sign-in for Codex sessions ends with the identity provider
 * redirecting the browser to a callback that Codex listens for on the loopback
 * address of the machine running the session. A browser on another device (a
 * phone, or a laptop viewing a remote server) cannot reach it, so the user can
 * paste the address that page ended on and Takode opens it on that machine.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The callback address Codex registered for a sign-in, read from its authorization URL. */
export function mcpOAuthRedirectUri(authorizationUrl: string): string | undefined {
  try {
    return new URL(authorizationUrl).searchParams.get("redirect_uri") ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Why a pasted address is not this sign-in's callback, or undefined when it is:
 * a loopback http address with the registered callback's port and path that
 * carries the provider's answer (`code` or `error`).
 */
export function mcpOAuthCallbackProblem(pasted: string, redirectUri: string | undefined): string | undefined {
  let url: URL;
  try {
    url = new URL(pasted.trim());
  } catch {
    return "That is not a web address. Paste the full address of the page the sign-in ended on.";
  }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) {
    return "That address is not a sign-in callback. It should start with http://127.0.0.1 or http://localhost.";
  }
  if (!url.searchParams.has("code") && !url.searchParams.has("error")) {
    return "That address has no sign-in result in it. Paste the address after finishing the sign-in.";
  }
  if (redirectUri) {
    const expected = new URL(redirectUri);
    if (url.port !== expected.port || url.pathname !== expected.pathname) {
      return "That address belongs to a different sign-in. Start the sign-in again and paste the new address.";
    }
  }
  return undefined;
}

/** Open a sign-in callback on this machine. Returns the HTTP status the callback answered with. */
export async function deliverMcpOAuthCallback(callbackUrl: string): Promise<number> {
  const url = new URL(callbackUrl);
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("Only a loopback http sign-in callback can be opened");
  }
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
  await response.body?.cancel();
  return response.status;
}

/** Open a sign-in callback on the session's machine: its remote host, or this one. */
export async function deliverMcpOAuthCallbackOnMachine(
  hostId: string | null | undefined,
  callbackUrl: string,
): Promise<number> {
  if (!hostId) return deliverMcpOAuthCallback(callbackUrl);
  const response = await requestOnHost(
    hostId,
    { kind: "operation", name: "deliverMcpOAuthCallback", args: [callbackUrl] },
    30_000,
  );
  return response.result as number;
}
