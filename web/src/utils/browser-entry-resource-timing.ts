import {
  BROWSER_ENTRY_RESOURCE_FIELDS,
  BROWSER_ENTRY_RESOURCE_LIMIT,
  BROWSER_LOAD_WINDOW_MS,
  type BrowserEntryResource,
  type BrowserEntryResourceSummary,
} from "../../shared/browser-load-diagnostics.js";

/** Read only the document's entry asset records; URLs never leave this function. */
export function readBrowserEntryResources(moduleStartedAtMs: number): BrowserEntryResourceSummary {
  if (performance.now() - moduleStartedAtMs > BROWSER_LOAD_WINDOW_MS) return { status: "expired", resources: [] };
  if (typeof performance.getEntriesByName !== "function") return { status: "unsupported", resources: [] };
  const targets = new Map<string, { role: BrowserEntryResource["role"]; url: string }>();
  for (const element of document.querySelectorAll('script[type="module"][src], link[rel~="stylesheet"][href]')) {
    const role = element.tagName === "SCRIPT" ? "entry_script" : "entry_stylesheet";
    const attribute = element.getAttribute(role === "entry_script" ? "src" : "href");
    if (!attribute) continue;
    let url: URL;
    try {
      url = new URL(attribute, document.baseURI);
    } catch {
      continue; // An invalid entry reference has no usable resource timing.
    }
    if (url.origin !== window.location.origin) continue;
    targets.set(`${role}:${url.href}`, { role, url: url.href });
    if (targets.size > BROWSER_ENTRY_RESOURCE_LIMIT) return { status: "ambiguous", resources: [] };
  }
  const resources: BrowserEntryResource[] = [];
  try {
    for (const { role, url } of targets.values()) {
      const entries = performance.getEntriesByName(url, "resource") as PerformanceResourceTiming[];
      if (entries.length !== 1) {
        resources.push({ role, status: entries.length === 0 ? "missing" : "ambiguous" });
        continue;
      }
      const entry = entries[0]!;
      const timings: NonNullable<BrowserEntryResource["timings"]> = {};
      for (const field of BROWSER_ENTRY_RESOURCE_FIELDS) {
        const value = entry[field];
        if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER)
          timings[field] = value;
      }
      resources.push({
        role,
        status:
          Object.keys(timings).length === BROWSER_ENTRY_RESOURCE_FIELDS.length && (timings.responseEnd ?? 0) > 0
            ? "available"
            : "partial",
        timings,
      });
    }
  } catch {
    // A browser without a usable Resource Timing implementation is explicitly incomplete.
    return { status: "unsupported", resources: [] };
  }
  for (const role of ["entry_script", "entry_stylesheet"] as const) {
    if (!resources.some((resource) => resource.role === role)) resources.push({ role, status: "missing" });
  }
  if (resources.length > BROWSER_ENTRY_RESOURCE_LIMIT) return { status: "ambiguous", resources: [] };
  return {
    status: resources.every((resource) => resource.status === "available") ? "complete" : "incomplete",
    resources,
  };
}
