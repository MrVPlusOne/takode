import { lstat, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { Context, MiddlewareHandler } from "hono";
import { serveStatic } from "hono/serve-static";
import { isFrontendCodeAsset } from "../shared/frontend-assets.js";
import { getStaticAssetCacheControl } from "./static-asset-cache.js";

/** Serve build-owned assets with lossless gzip negotiation and the existing static path/cache rules. */
export function serveFrontendAssets(frontendRoot: string): MiddlewareHandler {
  const root = resolve(frontendRoot);
  return serveStatic({
    root,
    join,
    isDir: (path) =>
      stat(path).then(
        (value) => value.isDirectory(),
        () => false,
      ),
    onFound: (path, context) => {
      const cacheControl = getStaticAssetCacheControl(path);
      if (cacheControl) context.header("Cache-Control", cacheControl);
    },
    getContent: async (path, context) => {
      const original = Bun.file(path);
      if (!(await original.exists())) return null;
      if (
        !isFrontendCodeAsset(relative(root, path).replaceAll("\\", "/")) ||
        (context.req.method !== "GET" && context.req.method !== "HEAD")
      )
        return fileBody(original);
      varyOnEncoding(context);
      const quality = encodingQuality(context.req.header("Accept-Encoding"));
      // Range requests retain the existing identity-file path. Encoded-byte ranges are not introduced.
      if (!context.req.header("Range") && quality.gzip > 0 && quality.gzip >= quality.identity) {
        const gzipPath = `${path}.gz`;
        // Companions must be ordinary snapshot files, not new symlink-based filesystem access.
        const info = await lstat(gzipPath).catch(() => null);
        if (info?.isFile() && info.size < original.size) {
          const encoded = Bun.file(gzipPath);
          context.header("Content-Encoding", "gzip");
          context.header("Content-Length", String(encoded.size));
          const etag = context.newResponse(null).headers.get("ETag");
          if (etag && !etag.startsWith("W/")) context.header("ETag", `W/${etag}`);
          return fileBody(encoded);
        }
      }
      if (quality.identity === 0) return new Response(null, { status: 406 });
      context.header("Content-Length", String(original.size));
      return fileBody(original);
    },
  });
}

function varyOnEncoding(context: Context): void {
  // Reading context.res before returning a file makes Hono clone its body as a stream.
  // Inspect prepared headers without replacing Bun's native file response.
  const fields =
    context
      .newResponse(null)
      .headers.get("Vary")
      ?.split(",")
      .map((field) => field.trim().toLowerCase()) ?? [];
  if (!fields.includes("*") && !fields.includes("accept-encoding"))
    context.header("Vary", "Accept-Encoding", { append: true });
}

function encodingQuality(header: string | undefined): { gzip: number; identity: number } {
  if (!header?.trim()) return { gzip: 0, identity: 1 };
  const qualities = new Map<string, number>();
  for (const item of header.split(",")) {
    const [name, ...parameters] = item
      .trim()
      .toLowerCase()
      .split(";")
      .map((part) => part.trim());
    const encoding = name === "x-gzip" ? "gzip" : name;
    if (encoding !== "gzip" && encoding !== "identity" && encoding !== "*") continue;
    const parameter = parameters[0];
    const valid =
      parameters.length === 0 || (parameters.length === 1 && /^q=(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(parameter!));
    const quality = valid ? (parameter ? Number(parameter.slice(2)) : 1) : 0;
    // Conflicting duplicates and malformed known codings cannot override an explicit exclusion.
    qualities.set(encoding, Math.min(qualities.get(encoding) ?? 1, quality));
  }
  const wildcard = qualities.get("*");
  return {
    gzip: qualities.get("gzip") ?? wildcard ?? 0,
    identity: qualities.get("identity") ?? (wildcard === 0 ? 0 : 1),
  };
}

/** Hono's core body type omits BunFile; its Bun adapter passes the same zero-copy file body. */
function fileBody(file: ReturnType<typeof Bun.file>): Parameters<Context["body"]>[0] {
  return file as unknown as Parameters<Context["body"]>[0];
}
