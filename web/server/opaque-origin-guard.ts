function decodeAndNormalizePathname(url: string): string | null {
  let pathname = new URL(url).pathname;
  for (let depth = 0; depth < 3 && /%[0-9a-f]{2}/i.test(pathname); depth += 1) {
    try {
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname) break;
      pathname = decoded;
    } catch {
      return null;
    }
  }

  const parts: string[] = [];
  for (const part of pathname.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join("/")}`.toLowerCase();
}

export function blockOpaqueOriginApplicationRequest(
  request: Request,
  options: { websocketRouteMatched: boolean },
): Response | null {
  if (request.headers.get("Origin")?.trim().toLowerCase() !== "null") return null;

  const pathname = decodeAndNormalizePathname(request.url);
  const targetsApplicationAuthority =
    pathname === null ||
    options.websocketRouteMatched ||
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/ws" ||
    pathname.startsWith("/ws/");
  if (!targetsApplicationAuthority) return null;

  return new Response("Opaque-origin documents cannot access Takode application APIs or WebSockets", {
    status: 403,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
