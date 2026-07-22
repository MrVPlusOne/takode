import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MEMORY_CATALOG_SOURCE_ID,
  MEMORY_CATALOG_TRUNCATED_PREFIX,
  MEMORY_CATALOG_UNAVAILABLE_PREFIX,
} from "../shared/injected-event-message.js";
import {
  buildAvailableMemoryCatalogBundle,
  buildMemoryCatalogInjectionBundle,
  buildUnavailableMemoryCatalogBundle,
} from "./memory-catalog-injection.js";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "takode-memory-catalog-injection-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("memory catalog injection", () => {
  it("renders compact catalog output with direct-file guidance and marks the target session seen", async () => {
    const root = await makeTempRoot();
    await mkdir(join(root, "decisions"), { recursive: true });
    await writeFile(
      join(root, "decisions", "memory-test.md"),
      [
        "---",
        "description: Test memory record for injected catalog coverage.",
        "source:",
        "  - q-test",
        "---",
        "",
        "# Decision",
        "",
        "Use direct file inspection after catalog orientation.",
      ].join("\n"),
      "utf-8",
    );

    const bundle = await buildMemoryCatalogInjectionBundle({
      repoOptions: { root },
      sessionId: "session-a",
      timeoutMs: 5_000,
    });

    expect(bundle.unavailable).toBe(false);
    expect(bundle.truncated).toBe(false);
    expect(bundle.agentSource.sessionId).toBe(MEMORY_CATALOG_SOURCE_ID);
    expect(bundle.content).toContain("Memory catalog preloaded");
    expect(bundle.content).toContain("Memory repo: " + root);
    expect(bundle.content).toContain("decisions/memory-test.md: Test memory record");
    expect(bundle.content).toContain("inspect the actual Markdown files directly");

    const seen = JSON.parse(
      await readFile(join(root, ".git", "takode-memory-catalog-seen", "session-a.json"), "utf-8"),
    ) as { entries: Array<{ path: string }> };
    expect(seen.entries.map((entry) => entry.path)).toContain("decisions/memory-test.md");
  });

  it("caps available catalog content with a visible truncation warning", () => {
    const bundle = buildAvailableMemoryCatalogBundle("Memory repo: /tmp/memory\n" + "x".repeat(1_000), {
      limit: 420,
    });

    expect(bundle.truncated).toBe(true);
    expect(bundle.unavailable).toBe(false);
    expect(bundle.content.length).toBeLessThanOrEqual(420);
    expect(bundle.content).toContain(MEMORY_CATALOG_TRUNCATED_PREFIX);
    expect(bundle.content).toContain("Run `memory catalog show` manually");
  });

  it("returns a fail-open warning bundle when catalog generation fails", async () => {
    const bundle = await buildMemoryCatalogInjectionBundle({
      catalog: async () => {
        throw new Error("memory repo unavailable");
      },
      markCatalogSeen: async () => {},
    });

    expect(bundle.unavailable).toBe(true);
    expect(bundle.truncated).toBe(false);
    expect(bundle.content).toContain(MEMORY_CATALOG_UNAVAILABLE_PREFIX);
    expect(bundle.content).toContain("memory repo unavailable");
  });

  it("can build an unavailable warning directly for recovery fallback paths", () => {
    const bundle = buildUnavailableMemoryCatalogBundle(new Error("boom"), { limit: 1_000 });

    expect(bundle.agentSource.sessionId).toBe(MEMORY_CATALOG_SOURCE_ID);
    expect(bundle.content).toContain(MEMORY_CATALOG_UNAVAILABLE_PREFIX);
    expect(bundle.content).toContain("boom");
  });
});
