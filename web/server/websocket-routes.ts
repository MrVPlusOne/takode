import { HOST_LINK_PATH } from "../shared/host-protocol.js";

export type WebSocketRouteMatch =
  | { kind: "browser"; sessionId: string }
  | { kind: "terminal"; terminalId: string }
  | { kind: "host" };

function decodePathSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    return decoded && !decoded.includes("/") ? decoded : null;
  } catch {
    return null;
  }
}

export function matchWebSocketRoute(pathname: string): WebSocketRouteMatch | null {
  const browserMatch = pathname.match(/^\/ws\/browser\/([^/]+)$/);
  if (browserMatch) {
    const sessionId = decodePathSegment(browserMatch[1]!);
    if (sessionId) return { kind: "browser", sessionId };
  }

  const terminalMatch = pathname.match(/^\/ws\/terminal\/([a-f0-9-]+)$/);
  if (terminalMatch) return { kind: "terminal", terminalId: terminalMatch[1]! };

  if (pathname === HOST_LINK_PATH) return { kind: "host" };

  return null;
}
