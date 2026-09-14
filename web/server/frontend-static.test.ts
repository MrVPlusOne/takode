import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serveFrontendAssets } from "./frontend-static.js";
import { getStaticAssetCacheControl } from "./static-asset-cache.js";

let root: string;
let app: Hono;
const body = Buffer.from('window.fixture = "unchanged";\n'.repeat(300));
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "frontend-gzip-serving-"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), "<main>fixture</main>");
  await writeFile(join(root, "index.html.gz"), gzipSync("<main>fixture</main>"));
  await writeFile(join(root, "takode-build.json"), '{"version":1,"buildId":"fixture"}');
  for (const name of ["app.js", "app.css", "image.svg", "font.woff2", "app.js.map"]) {
    await writeFile(join(root, "assets", name), body);
    await writeFile(join(root, "assets", name + ".gz"), gzipSync(body));
  }
  app = new Hono();
  app.use("*", async (c, next) => {
    c.header("Vary", "Origin");
    c.header("ETag", '"identity-tag"');
    await next();
  });
  app.get("/api/example.js", (c) => c.text("authoritative API"));
  app.get("/file-preview/example.js", (c) => c.text("separate file authority"));
  app.use("*", serveFrontendAssets(root));
  app.get(
    "*",
    serveStatic({
      path: join(root, "index.html"),
      onFound: (path, c) => {
        const value = getStaticAssetCacheControl(path);
        if (value) c.header("Cache-Control", value);
      },
    }),
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function expectRepresentation(header: string | undefined, encoding: "gzip" | "identity" | "none") {
  const response = await app.request("/assets/app.js", {
    headers: header === undefined ? {} : { "Accept-Encoding": header },
  });
  expect(response.headers.get("Vary")).toBe("Origin, Accept-Encoding");
  if (encoding === "none") {
    expect(response.status).toBe(406);
    return;
  }
  expect(response.status).toBe(200);
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(response.headers.get("Content-Type")).toMatch(/javascript/);
  expect(response.headers.get("Cache-Control")).toBeNull();
  expect(response.headers.get("Content-Length")).toBe(String(bytes.byteLength));
  if (encoding === "gzip") {
    expect(response.headers.get("Content-Encoding")).toBe("gzip");
    expect(response.headers.get("ETag")).toBe('W/"identity-tag"');
    expect(gunzipSync(bytes)).toEqual(body);
  } else {
    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(response.headers.get("ETag")).toBe('"identity-tag"');
    expect(bytes).toEqual(body);
  }
}

describe("static gzip representations", () => {
  it("retains native file framing and browser decoding over actual HTTP", async () => {
    // app.request cannot expose a BunFile accidentally converted into a stream by Hono.
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
    try {
      const encodedSize = (await readFile(join(root, "assets/app.js.gz"))).length;
      for (const encoding of ["identity", "gzip"]) {
        const response = await fetch(`http://127.0.0.1:${server.port}/assets/app.js`, {
          headers: { "Accept-Encoding": encoding },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Length")).toBe(String(encoding === "gzip" ? encodedSize : body.length));
        expect(response.headers.get("Transfer-Encoding")).toBeNull();
        expect(Buffer.from(await response.arrayBuffer())).toEqual(body);
      }
    } finally {
      server.stop(true);
    }
  });

  it.each([
    [undefined, "identity"],
    ["", "identity"],
    ["gzip, deflate, br", "gzip"],
    ["GZip ; q=1", "gzip"],
    ["x-gzip", "gzip"],
    ["gzip;q=0", "identity"],
    ["br", "identity"],
    ["gzip;q=0.5, identity;q=0.8", "identity"],
    ["gzip;q=0.8, identity;q=0.5", "gzip"],
    ["*", "gzip"],
    ["*;q=0.5, identity;q=0", "gzip"],
    ["*;q=0", "none"],
    ["gzip;q=0, *;q=1", "identity"],
    ["gzip, identity;q=0", "gzip"],
    ["gzip;q=0, identity;q=0", "none"],
    ["gzip;q=0, gzip;q=1", "identity"],
    ["gzip;q=invalid", "identity"],
    ["gzip;q=1.1, identity;q=0", "none"],
    ["identity;q=1, *;q=0", "identity"],
  ] as const)("negotiates %s as %s", async (header, encoding) => {
    // Requests use real Hono/Bun file responses; app.request leaves encoded bytes available for equality checks.
    await expectRepresentation(header, encoding);
  });

  it("keeps stylesheet MIME, HEAD representation metadata, and identity range behavior", async () => {
    const css = await app.request("/assets/app.css", { headers: { "Accept-Encoding": "gzip" } });
    expect(css.headers.get("Content-Type")).toMatch(/text\/css/);
    expect(gunzipSync(Buffer.from(await css.arrayBuffer()))).toEqual(body);
    const head = await app.request("/assets/app.js", { method: "HEAD", headers: { "Accept-Encoding": "gzip" } });
    expect(head.headers.get("Content-Encoding")).toBe("gzip");
    expect(head.headers.get("Content-Length")).toBe(String((await readFile(join(root, "assets/app.js.gz"))).length));
    expect(await head.text()).toBe("");
    const range = await app.request("/assets/app.js", { headers: { "Accept-Encoding": "gzip", Range: "bytes=0-9" } });
    expect(range.headers.get("Content-Encoding")).toBeNull();
    expect(Buffer.from(await range.arrayBuffer())).toEqual(body);
    const excluded = await app.request("/assets/app.js", {
      headers: { "Accept-Encoding": "gzip, identity;q=0", Range: "bytes=0-9" },
    });
    expect(excluded.status).toBe(406);
  });

  it("falls back only to an acceptable original for missing, larger, or symlinked companions", async () => {
    await rm(join(root, "assets/app.js.gz"));
    await expectRepresentation("gzip", "identity");
    await expectRepresentation("gzip, identity;q=0", "none");
    await writeFile(join(root, "assets/app.js.gz"), Buffer.alloc(body.length + 1));
    await expectRepresentation("gzip", "identity");
    await rm(join(root, "assets/app.js.gz"));
    await symlink(join(root, "assets/app.css.gz"), join(root, "assets/app.js.gz"));
    await expectRepresentation("gzip", "identity");
  });

  it("does not encode HTML, manifests, APIs, file links, maps, images, or fonts", async () => {
    for (const path of [
      "/",
      "/index.html",
      "/takode-build.json",
      "/api/example.js",
      "/file-preview/example.js",
      "/assets/app.js.map",
      "/assets/image.svg",
      "/assets/font.woff2",
      "/assets/missing.js",
    ]) {
      const response = await app.request(path, { headers: { "Accept-Encoding": "gzip" } });
      expect(response.headers.get("Content-Encoding"), path).toBeNull();
      if (path === "/" || path === "/index.html") expect(response.headers.get("Cache-Control"), path).toBe("no-store");
    }
    // Missing/traversal behavior must match the existing Bun adapter, including its SPA fallback.
    const baseline = new Hono();
    baseline.use("*", serveStatic({ root }));
    baseline.get("*", serveStatic({ path: join(root, "index.html") }));
    for (const path of ["/assets/missing.js", "/assets/%2e%2e%2foutside.js"]) {
      const response = await app.request(path, { headers: { "Accept-Encoding": "gzip" } });
      const previous = await baseline.request(path);
      expect(response.headers.get("Content-Encoding")).toBeNull();
      expect(response.status).toBe(previous.status);
      expect(await response.text()).toBe(await previous.text());
    }
  });

  it("preserves an existing wildcard Vary without adding another value", async () => {
    const wildcard = new Hono();
    wildcard.use("*", async (c, next) => {
      c.header("Vary", "*");
      await next();
    });
    wildcard.use("*", serveFrontendAssets(root));
    const response = await wildcard.request("/assets/app.js", { headers: { "Accept-Encoding": "gzip" } });
    expect(response.headers.get("Vary")).toBe("*");
  });
});
