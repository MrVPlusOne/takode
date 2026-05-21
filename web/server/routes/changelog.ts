import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import type { RouteContext } from "./context.js";

export interface ChangelogResponse {
  markdown: string;
  sourcePath: string;
}

export function repositoryChangelogPath(webDir: string): string {
  return join(dirname(webDir), "CHANGELOG.md");
}

export function createChangelogRoutes(ctx: Pick<RouteContext, "WEB_DIR">) {
  const api = new Hono();

  api.get("/changelog", async (c) => {
    const sourcePath = "CHANGELOG.md";
    const changelogPath = repositoryChangelogPath(ctx.WEB_DIR);
    try {
      const markdown = await readFile(changelogPath, "utf8");
      return c.json({ markdown, sourcePath } satisfies ChangelogResponse);
    } catch (err: unknown) {
      if (isMissingFileError(err)) {
        return c.json({ error: "Changelog file not found" }, 404);
      }
      console.error("Failed to read changelog:", err);
      return c.json({ error: "Unable to read changelog" }, 500);
    }
  });

  return api;
}

function isMissingFileError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "ENOENT";
}
