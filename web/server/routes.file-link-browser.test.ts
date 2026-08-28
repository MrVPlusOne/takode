import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { createFileLinkBrowserRoutes } from "./routes/file-link-browser.js";

function makeApp(root: string, options?: Parameters<typeof createFileLinkBrowserRoutes>[1]) {
  const app = new Hono();
  app.route(
    "/",
    createFileLinkBrowserRoutes(
      {
        getSession: (sessionId: string) =>
          sessionId === "s1"
            ? {
                state: {
                  cwd: root,
                  repo_root: root,
                  is_worktree: false,
                },
              }
            : null,
      } as never,
      options,
    ),
  );
  return app;
}

async function openHtml(
  app: Hono,
  path: string,
  options?: { isRelative?: boolean; sessionId?: string | null; headers?: Record<string, string> },
) {
  const params = new URLSearchParams({
    path,
    isRelative: options?.isRelative === false ? "0" : "1",
  });
  if (options?.sessionId !== null) params.set("sessionId", options?.sessionId ?? "s1");
  return app.request(`/file-preview/open?${params.toString()}`, { headers: options?.headers });
}

function redirectedPath(response: Response): string {
  const location = response.headers.get("Location");
  if (!location) throw new Error("Expected redirect Location");
  return new URL(location, "http://localhost").pathname;
}

function resolvePreviewPath(reference: string, documentPath: string): string {
  return new URL(reference, `http://localhost${documentPath}`).pathname;
}

describe("HTML file-link browser routes", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "file-link-browser-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("serves exact HTML plus recursively declared document-, script-, and stylesheet-relative assets", async () => {
    // The path-shaped capability mirrors the entry under a stable session root.
    // Window fetch() uses the document base, while module imports and CSS URLs use
    // the external source file, matching browser URL resolution instead of treating
    // every JavaScript literal as script-relative.
    const demoDir = join(tempDir, "docs", "demo");
    await mkdir(join(demoDir, "styles"), { recursive: true });
    await mkdir(join(demoDir, "scripts"), { recursive: true });
    await mkdir(join(tempDir, "docs", "shared"), { recursive: true });
    await mkdir(join(tempDir, "docs", "images"), { recursive: true });
    const html = [
      "<!doctype html>",
      '<link rel="stylesheet" href="./styles/demo.css">',
      '<script type="module" src="./scripts/demo.js"></script>',
      '<img src="./badge.svg">',
    ].join("");
    await writeFile(join(demoDir, "index.HTML"), html);
    await writeFile(join(demoDir, "styles", "demo.css"), 'body { background: url("../../images/bg.svg"); }\n');
    await writeFile(join(demoDir, "scripts", "demo.js"), "fetch(`../shared/data.json`); import(`./module.js`);\n");
    await writeFile(join(demoDir, "scripts", "module.js"), "export const loaded = true;\n");
    await writeFile(join(demoDir, "badge.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script /></svg>');
    await writeFile(join(tempDir, "docs", "shared", "data.json"), '{"ok":true}\n');
    await writeFile(join(tempDir, "docs", "images", "bg.svg"), '<svg xmlns="http://www.w3.org/2000/svg" />');

    const app = makeApp(tempDir);
    const entry = await openHtml(app, "docs/demo/index.HTML");

    expect(entry.status).toBe(302);
    expect(entry.headers.get("Cache-Control")).toBe("no-store");
    expect(entry.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(entry.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const contentPath = redirectedPath(entry);
    expect(contentPath).toMatch(/^\/file-preview\/content\/[0-9a-f-]+\/root\/docs\/demo\/index\.HTML$/i);

    const documentResponse = await app.request(contentPath);
    expect(documentResponse.status).toBe(200);
    expect(await documentResponse.text()).toBe(html);
    expect(documentResponse.headers.get("Content-Type")).toMatch(/^text\/html/i);
    expect(documentResponse.headers.get("Access-Control-Allow-Origin")).toBe("null");
    expect(documentResponse.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(documentResponse.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    const sandbox = documentResponse.headers.get("Content-Security-Policy") ?? "";
    expect(sandbox).toContain("sandbox");
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
    expect(await readFile(join(demoDir, "index.HTML"), "utf8")).toBe(html);

    const cssPath = resolvePreviewPath("./styles/demo.css", contentPath);
    const cssResponse = await app.request(cssPath);
    expect(cssResponse.status).toBe(200);
    expect(cssResponse.headers.get("Content-Type")).toMatch(/^text\/css/i);

    const cssImageResponse = await app.request(resolvePreviewPath("../../images/bg.svg", cssPath));
    expect(cssImageResponse.status).toBe(200);
    expect(cssImageResponse.headers.get("Content-Type")).toMatch(/^image\/svg\+xml/i);

    const scriptPath = resolvePreviewPath("./scripts/demo.js", contentPath);
    const scriptResponse = await app.request(scriptPath);
    expect(scriptResponse.status).toBe(200);
    expect(scriptResponse.headers.get("Content-Type")).toMatch(/javascript/i);

    const documentRelativeData = await app.request(resolvePreviewPath("../shared/data.json", contentPath));
    expect(documentRelativeData.status).toBe(200);
    expect(documentRelativeData.headers.get("Content-Type")).toMatch(/^application\/json/i);
    expect(documentRelativeData.headers.get("Access-Control-Allow-Origin")).toBe("null");

    const scriptRelativeModule = await app.request(resolvePreviewPath("./module.js", scriptPath));
    expect(scriptRelativeModule.status).toBe(200);

    const svgResponse = await app.request(resolvePreviewPath("./badge.svg", contentPath));
    expect(svgResponse.status).toBe(200);
    expect(svgResponse.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(svgResponse.headers.get("Content-Security-Policy")).not.toContain("allow-same-origin");
  });

  it("ignores commented-out base and asset markup when authorizing the live document", async () => {
    // HTML comments are not DOM nodes. A stale commented base must not redirect
    // real relative URLs, and commented asset tags must not expand the allowlist.
    await writeFile(
      join(tempDir, "index.html"),
      '<!-- <base href="../stale/"><script src="./commented.js"></script> --><script src="./live.js"></script>',
    );
    await writeFile(join(tempDir, "live.js"), "document.body.dataset.loaded = 'true';\n");
    await writeFile(join(tempDir, "commented.js"), "throw new Error('not live');\n");

    const app = makeApp(tempDir);
    const documentPath = redirectedPath(await openHtml(app, "index.html"));
    expect((await app.request(documentPath)).status).toBe(200);
    expect((await app.request(resolvePreviewPath("./live.js", documentPath))).status).toBe(200);
    expect((await app.request(resolvePreviewPath("./commented.js", documentPath))).status).toBe(403);
  });

  it("honors a local HTML base href for document URLs while keeping module imports source-relative", async () => {
    // Browsers use the first <base href> for HTML attributes and window fetch(),
    // but an external module import remains relative to that module's own URL.
    await mkdir(join(tempDir, "docs", "page"), { recursive: true });
    await mkdir(join(tempDir, "runtime"), { recursive: true });
    await mkdir(join(tempDir, "code"), { recursive: true });
    await writeFile(
      join(tempDir, "docs", "page", "index.html"),
      '<base href="../../runtime/"><script type="module" src="../code/app.js"></script>',
    );
    await writeFile(join(tempDir, "code", "app.js"), 'fetch("./data.json"); import("./module.js");\n');
    await writeFile(join(tempDir, "code", "module.js"), "export const ok = true;\n");
    await writeFile(join(tempDir, "runtime", "data.json"), '{"base":true}\n');

    const app = makeApp(tempDir);
    const documentPath = redirectedPath(await openHtml(app, "docs/page/index.html"));
    expect((await app.request(documentPath)).status).toBe(200);

    const runtimeBasePath = resolvePreviewPath("../../runtime/", documentPath);
    const scriptPath = resolvePreviewPath("../code/app.js", runtimeBasePath);
    expect((await app.request(scriptPath)).status).toBe(200);
    expect((await app.request(resolvePreviewPath("./data.json", runtimeBasePath))).status).toBe(200);
    expect((await app.request(resolvePreviewPath("./module.js", scriptPath))).status).toBe(200);
  });

  it("keeps the bootstrap user-navigation-only when browser fetch metadata is present", async () => {
    // A script fetch or a sibling localhost origin must not mint a capability;
    // normal same-origin user navigation from the Takode page remains allowed.
    await writeFile(join(tempDir, "index.html"), "<!doctype html>");
    const app = makeApp(tempDir);

    const fetchAttempt = await openHtml(app, "index.html", {
      headers: {
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
      },
    });
    expect(fetchAttempt.status).toBe(403);
    expect(await fetchAttempt.text()).toContain("user navigation");

    const siblingOrigin = await openHtml(app, "index.html", {
      headers: {
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-site",
        "Sec-Fetch-User": "?1",
      },
    });
    expect(siblingOrigin.status).toBe(403);

    const navigation = await openHtml(app, "index.html", {
      headers: {
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
      },
    });
    expect(navigation.status).toBe(302);
    expect(navigation.headers.get("Cache-Control")).toBe("no-store");
    expect(navigation.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(navigation.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("returns visible errors for missing, non-file, non-HTML, and unresolvable targets", async () => {
    // Invalid HTML links should fail visibly in the new tab instead of silently
    // falling through to the editor or a broken privileged URL.
    await mkdir(join(tempDir, "directory.html"));
    await writeFile(join(tempDir, "notes.txt"), "not html\n");
    const app = makeApp(tempDir);

    const missing = await openHtml(app, "missing.html");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("was not found");

    const directory = await openHtml(app, "directory.html");
    expect(directory.status).toBe(404);
    expect(await directory.text()).toContain("was not found");

    const nonHtml = await openHtml(app, "notes.txt");
    expect(nonHtml.status).toBe(400);
    expect(await nonHtml.text()).toContain("not an .html file");

    const missingSessionRoot = await openHtml(app, "index.html", { sessionId: "unknown" });
    expect(missingSessionRoot.status).toBe(400);
    expect(await missingSessionRoot.text()).toContain("without a session filesystem root");
  });

  it("serves only declared assets and rejects sensitive directories, canonical credential symlinks, traversal, and root escapes", async () => {
    // Literal references are exact capabilities rather than a generic filesystem
    // reader. Sensitive checks apply to every requested and canonical path segment,
    // including an innocent-looking in-root symlink to a credential file.
    const demoDir = join(tempDir, "demo");
    const outsideDir = await mkdtemp(join(tmpdir(), "file-link-browser-outside-"));
    await mkdir(join(demoDir, "assets"), { recursive: true });
    await mkdir(join(demoDir, "secrets"), { recursive: true });
    await writeFile(
      join(demoDir, "index.html"),
      [
        '<script>fetch("./inside.txt"); fetch("./assets/data.json"); fetch("./secrets/public.json")</script>',
        '<a href="./leak.txt">leak</a>',
      ].join(""),
    );
    await writeFile(join(demoDir, "inside.txt"), "inside\n");
    await writeFile(join(demoDir, "unrelated.txt"), "unrelated\n");
    await writeFile(join(demoDir, ".env"), "TOKEN=secret\n");
    await writeFile(join(demoDir, "secrets", "public.json"), '{"secret":true}\n');
    await symlink(join(demoDir, ".env"), join(demoDir, "assets", "data.json"));
    await writeFile(join(outsideDir, "secret.txt"), "secret\n");
    await symlink(join(outsideDir, "secret.txt"), join(demoDir, "leak.txt"));

    try {
      const app = makeApp(tempDir);
      const entry = await openHtml(app, "demo/index.html");
      const contentPath = redirectedPath(entry);

      const inside = await app.request(resolvePreviewPath("./inside.txt", contentPath));
      expect(inside.status).toBe(200);
      expect(await inside.text()).toBe("inside\n");

      const unrelated = await app.request(resolvePreviewPath("./unrelated.txt", contentPath));
      expect(unrelated.status).toBe(403);
      expect(await unrelated.text()).toContain("not declared");

      const sensitiveDirectory = await app.request(resolvePreviewPath("./secrets/public.json", contentPath));
      expect(sensitiveDirectory.status).toBe(403);

      const canonicalCredential = await app.request(resolvePreviewPath("./assets/data.json", contentPath));
      expect(canonicalCredential.status).toBe(403);
      expect(await canonicalCredential.text()).toContain("protected path");

      const encodedTraversal = await app.request(
        `${contentPath.slice(0, contentPath.indexOf("/root/") + 6)}%252e%252e%252fsecret.txt`,
      );
      expect(encodedTraversal.status).toBe(400);
      expect(await encodedTraversal.text()).toContain("Invalid HTML preview asset path");

      const symlinkEscape = await app.request(resolvePreviewPath("./leak.txt", contentPath));
      expect(symlinkEscape.status).toBe(403);
      expect(await symlinkEscape.text()).toContain("escapes its authorized root");
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("rejects an entry symlink that escapes its bounded session package", async () => {
    // The capability must never scan one canonical file and later resolve the same
    // virtual basename against a different directory or decoy file.
    const outsideDir = await mkdtemp(join(tmpdir(), "file-link-browser-entry-symlink-"));
    await writeFile(join(outsideDir, "actual.html"), "<!doctype html><p>actual</p>");
    await writeFile(join(outsideDir, "link.html"), "<!doctype html><p>decoy</p>");
    await symlink(join(outsideDir, "actual.html"), join(tempDir, "link.html"));

    try {
      const app = makeApp(tempDir);
      const response = await openHtml(app, "link.html");
      expect(response.status).toBe(403);
      expect(await response.text()).toContain("entry symlink escapes");
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("uses the declared virtual extension for MIME, sandbox, and recursive scanning through in-root symlinks", async () => {
    // The browser sees index.html and bundle.js even when those declared paths point
    // to extensionless generated files, so response classification must follow the
    // authorized URL while canonical paths remain boundary checks only.
    await writeFile(join(tempDir, "page-source"), '<script src="./bundle.js"></script>');
    await writeFile(join(tempDir, "bundle-source"), 'fetch("./data.json");\n');
    await writeFile(join(tempDir, "data.json"), '{"ok":true}\n');
    await symlink("page-source", join(tempDir, "index.html"));
    await symlink("bundle-source", join(tempDir, "bundle.js"));

    const app = makeApp(tempDir);
    const documentPath = redirectedPath(await openHtml(app, "index.html"));
    const documentResponse = await app.request(documentPath);
    expect(documentResponse.status).toBe(200);
    expect(documentResponse.headers.get("Content-Type")).toMatch(/^text\/html/i);
    expect(documentResponse.headers.get("Content-Security-Policy")).toContain("sandbox");

    const scriptPath = resolvePreviewPath("./bundle.js", documentPath);
    const scriptResponse = await app.request(scriptPath);
    expect(scriptResponse.status).toBe(200);
    expect(scriptResponse.headers.get("Content-Type")).toMatch(/javascript/i);
    expect((await app.request(resolvePreviewPath("./data.json", documentPath))).status).toBe(200);
  });

  it("bounds absolute HTML targets to their chosen directory while preserving same-directory assets", async () => {
    // Absolute links outside a selected session have no trustworthy project root.
    // Their chosen directory is the bounded package root: declared siblings work,
    // while ../ cannot become a filesystem-volume reader for unrelated files.
    const absolutePackage = await mkdtemp(join(tmpdir(), "file-link-browser-absolute-"));
    await mkdir(join(absolutePackage, "page"), { recursive: true });
    await writeFile(
      join(absolutePackage, "page", "index.html"),
      '<script>fetch("./data.json"); fetch("../outside.json")</script>',
    );
    await writeFile(join(absolutePackage, "page", "data.json"), '{"sibling":true}\n');
    await writeFile(join(absolutePackage, "outside.json"), '{"outside":true}\n');

    try {
      const app = makeApp(tempDir);
      const documentPath = redirectedPath(
        await openHtml(app, join(absolutePackage, "page", "index.html"), { isRelative: false }),
      );
      expect((await app.request(documentPath)).status).toBe(200);
      const siblingResponse = await app.request(resolvePreviewPath("./data.json", documentPath));
      expect(siblingResponse.status).toBe(200);
      expect(await siblingResponse.text()).toBe('{"sibling":true}\n');
      const outsideResponse = await app.request(resolvePreviewPath("../outside.json", documentPath));
      expect(outsideResponse.status).toBe(404);
      expect(await outsideResponse.text()).toBe("Unknown HTML preview route");
    } finally {
      await rm(absolutePackage, { recursive: true, force: true });
    }
  });

  it("bounds literal-reference scanning without buffering oversized sources and still serves their exact bytes", async () => {
    // Oversized HTML/JS remains faithfully streamable, but recursive declaration
    // discovery is skipped once the bounded scanner budget is exceeded.
    const largeScript = `${'fetch("./data.json");'.padEnd(80, " ")}\n`;
    await writeFile(join(tempDir, "index.html"), '<script src="./large.js"></script>');
    await writeFile(join(tempDir, "large.js"), largeScript);
    await writeFile(join(tempDir, "data.json"), '{"large":true}\n');
    const app = makeApp(tempDir, { scanFileByteLimit: 64, scanTotalByteLimit: 128, scanOperationLimit: 8 });
    const documentPath = redirectedPath(await openHtml(app, "index.html"));
    expect((await app.request(documentPath)).status).toBe(200);

    const scriptResponse = await app.request(resolvePreviewPath("./large.js", documentPath));
    expect(scriptResponse.status).toBe(200);
    expect(await scriptResponse.text()).toBe(largeScript);
    expect((await app.request(resolvePreviewPath("./data.json", documentPath))).status).toBe(403);
  });

  it("redirects authorized directories to a trailing slash before serving their index", async () => {
    // A slash redirect preserves the correct browser base URL for nested index
    // documents and their own relative assets.
    await mkdir(join(tempDir, "demo", "nested"), { recursive: true });
    await writeFile(join(tempDir, "demo", "index.html"), '<iframe src="./nested/"></iframe>');
    await writeFile(join(tempDir, "demo", "nested", "index.html"), '<script src="./child.js"></script>');
    await writeFile(join(tempDir, "demo", "nested", "child.js"), "document.body.dataset.loaded = 'true';\n");

    const app = makeApp(tempDir);
    const entryPath = redirectedPath(await openHtml(app, "demo/index.html"));
    const directoryPath = resolvePreviewPath("./nested", entryPath);
    const directoryResponse = await app.request(directoryPath);
    expect(directoryResponse.status).toBe(307);
    expect(directoryResponse.headers.get("Location")).toBe(`${directoryPath}/`);
    expect(directoryResponse.headers.get("Cache-Control")).toBe("no-store");

    const nestedDocumentPath = `${directoryPath}/`;
    const nestedDocument = await app.request(nestedDocumentPath);
    expect(nestedDocument.status).toBe(200);
    expect(nestedDocument.headers.get("Content-Security-Policy")).toContain("sandbox");
    const childScript = await app.request(resolvePreviewPath("./child.js", nestedDocumentPath));
    expect(childScript.status).toBe(200);
  });

  it("expires capabilities at a fixed deadline and supports opaque-origin asset preflights", async () => {
    // Capability lifetime is absolute rather than sliding, so repeated asset reads
    // cannot keep a leaked token alive indefinitely.
    let now = 100;
    await writeFile(join(tempDir, "index.html"), "<!doctype html>");
    const app = makeApp(tempDir, { capabilityTtlMs: 10, now: () => now });
    const contentPath = redirectedPath(await openHtml(app, "index.html"));

    now = 105;
    expect((await app.request(contentPath)).status).toBe(200);
    now = 111;
    const expired = await app.request(contentPath);
    expect(expired.status).toBe(410);
    expect(await expired.text()).toContain("expired");

    const unknown = await app.request("/file-preview/content/not-a-token/root/index.html");
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toContain("unavailable");

    const preflight = await app.request("/file-preview/content/not-a-token/root/data.json", {
      method: "OPTIONS",
      headers: {
        Origin: "null",
        "Access-Control-Request-Headers": "x-demo",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("null");
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toBe("x-demo");
  });

  it("fails closed across the whole preview namespace before a production SPA fallback", async () => {
    // Production's global index.html fallback must never turn a malformed, stale,
    // or URL-normalized preview URL into a privileged Takode app-shell response.
    const app = makeApp(tempDir);
    app.get("*", (c) => c.html("TAKODE APP SHELL"));

    const miss = await app.request("/file-preview/content/stale-token/not-root/index.html");
    expect(miss.status).toBe(404);
    expect(await miss.text()).toBe("Unknown HTML preview route");
  });
});
