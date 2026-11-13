/**
 * Adjusts the page for the demo before any app module loads: the app's pictures come from the
 * demo's folder (or embedded copies), and storage falls back to memory where the page may not use
 * the browser's. Imported first by main.tsx.
 */
/**
 * The app names its pictures by absolute path ("/app-logo.png"), which on the site would point at
 * the site's root; the demo serves them from public/ beside its page.
 */
function serveAppAssetsFromDemo(): void {
  // A single-file preview of the page embeds the pictures and lists them here instead.
  const embedded = (window as unknown as { TAKODE_DEMO_ASSETS?: Record<string, string> }).TAKODE_DEMO_ASSETS;
  const base = embedded ? "" : new URL("./public/", location.href).href;
  const local = (value: unknown) => {
    if (typeof value !== "string" || !/^\/(?!\/|api\/|ws\/)/.test(value)) return value;
    return embedded ? (embedded[value.slice(1)] ?? value) : base + value.slice(1);
  };
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name: string, value: string) {
    setAttribute.call(this, name, name === "src" || name === "href" ? String(local(value)) : value);
  };
  for (const proto of [HTMLImageElement.prototype, HTMLLinkElement.prototype]) {
    for (const prop of ["src", "href"] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
      if (!descriptor?.set) continue;
      Object.defineProperty(proto, prop, {
        ...descriptor,
        set(value: string) {
          descriptor.set!.call(this, local(value));
        },
      });
    }
  }
}
serveAppAssetsFromDemo();

/**
 * Pages served without an origin of their own (Takode's file viewer, for one) refuse browser
 * storage; the app keeps its state in memory there instead.
 */
function keepStorageInMemoryWhereRefused(): void {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      void window[name].length;
    } catch {
      const items = new Map<string, string>();
      const storage: Storage = {
        get length() {
          return items.size;
        },
        key: (index) => [...items.keys()][index] ?? null,
        getItem: (key) => items.get(key) ?? null,
        setItem: (key, value) => void items.set(key, String(value)),
        removeItem: (key) => void items.delete(key),
        clear: () => items.clear(),
      };
      Object.defineProperty(window, name, { value: storage, configurable: true });
    }
  }
}
keepStorageInMemoryWhereRefused();

/**
 * A single-file preview runs the app in a srcdoc frame, where relative URLs resolve against the
 * parent page's address. The app moves between views with relative history URLs ("#/session/…"),
 * so resolve them against the frame's own address; the browser refuses the parent's.
 */
function keepHistoryInSrcdocFrame(): void {
  if (location.href.split("#")[0] !== "about:srcdoc") return;
  for (const method of ["pushState", "replaceState"] as const) {
    const update = history[method].bind(history);
    history[method] = (state, unused, url) => {
      const given = url == null ? null : String(url);
      if (given === null || given.startsWith("about:")) return update(state, unused, url);
      // Any other relative URL is the app's own path, which here means the frame with no view.
      update(state, unused, given.startsWith("#") ? `about:srcdoc${given}` : "about:srcdoc");
    };
  }
}
keepHistoryInSrcdocFrame();

/** The sidebar's build stamp says when this copy of the app was built, which means nothing in the demo. */
function hideBuildStamp(): void {
  const style = document.createElement("style");
  style.textContent = `
button[aria-label$=". Open changelog"],
span[aria-hidden="true"]:has(+ span button[aria-label$=". Open changelog"]) { display: none; }`;
  document.head.append(style);
}
hideBuildStamp();
