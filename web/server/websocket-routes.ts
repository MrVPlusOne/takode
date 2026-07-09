export type WebSocketRouteMatch =
  | { kind: "cli"; sessionId: string }
  | { kind: "browser"; sessionId: string }
  | { kind: "terminal"; terminalId: string };

function decodePathSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    return decoded && !decoded.includes("/") ? decoded : null;
  } catch {
    return null;
  }
}

export function matchWebSocketRoute(pathname: string): WebSocketRouteMatch | null {
  const cliMatch = pathname.match(/^\/ws\/cli\/([a-f0-9-]+)$/);
  if (cliMatch) return { kind: "cli", sessionId: cliMatch[1]! };

  const browserMatch = pathname.match(/^\/ws\/browser\/([^/]+)$/);
  if (browserMatch) {
    const sessionId = decodePathSegment(browserMatch[1]!);
    if (sessionId) return { kind: "browser", sessionId };
  }

  const terminalMatch = pathname.match(/^\/ws\/terminal\/([a-f0-9-]+)$/);
  if (terminalMatch) return { kind: "terminal", terminalId: terminalMatch[1]! };

  return null;
}
