import { LOCAL_HOST_ID } from "../../shared/host-protocol.js";

/** The host port is the main port plus this, unless `COMPANION_HOST_LINK_PORT` names another. */
const HOST_PORT_OFFSET = 1000;

/** The coordinator's host port for a server on `mainPort`. */
export function hostPortFor(mainPort: number, env: NodeJS.ProcessEnv = process.env): number {
  return Number(env.COMPANION_HOST_LINK_PORT) || mainPort + HOST_PORT_OFFSET;
}

/**
 * The 401 response for a request on the host port that proves nothing, or null
 * to let it through.
 *
 * The host port is the coordinator's entrance for hosts: tunnels from other
 * machines end there, so on a shared host any local user can reach it. Unlike
 * the main port it never serves anonymous callers, whatever the browser-login
 * setting: the host link authenticates itself with its host token, and
 * everything else needs a valid agent session token, which agent CLIs send
 * through their node's API proxy.
 */
export function hostPortGate(
  request: Request,
  options: { isHostLink: boolean; hasSessionToken: (request: Request) => boolean },
): Response | null {
  if (options.isHostLink || options.hasSessionToken(request)) return null;
  return new Response(
    JSON.stringify({ error: "This port serves Takode hosts and their agents only; send a host or session token." }),
    { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
}

/**
 * Why the main port refuses another machine's host link, or null to accept it.
 *
 * A host reaching the main port through a tunnel leaves that tunnel's end open
 * on the host, and while browser login is off the main port serves anyone, so
 * every user on that machine could use Takode. Such hosts must use the host
 * port instead. This machine's own node, and any host while login is on, may
 * stay on the main port.
 */
export function mainPortHostRefusal(
  hostId: string,
  options: { loginEnabled: boolean; mainPort: number; hostPort: number },
): string | null {
  if (hostId === LOCAL_HOST_ID || options.loginEnabled) return null;
  return (
    `Hosts must connect to this coordinator's host port ${options.hostPort}, not its main port ${options.mainPort}: ` +
    "with browser login off, a tunnel to the main port lets every user on the host use Takode. " +
    `Point the tunnel or address at port ${options.hostPort} (for example ssh -R <local port>:127.0.0.1:${options.hostPort}).`
  );
}
