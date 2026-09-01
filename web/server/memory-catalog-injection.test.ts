import { afterEach, describe, expect, it, vi } from "vitest";
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
  recordMemoryCatalogSeenAfterDelivery,
} from "./memory-catalog-injection.js";
import type { MemoryCatalog } from "./workstream-memory-types.js";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "takode-memory-catalog-injection-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function catalogFixture(root = "/tmp/takode-memory"): MemoryCatalog {
  return {
    repo: {
      root,
      serverId: "test-server",
      serverSlug: "test",
      sessionSpaceSlug: "Takode",
      initialized: true,
      authoredDirs: ["current", "knowledge", "procedures", "decisions", "references", "artifacts"],
    },
    entries: [],
    issues: [],
  };
}

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
    expect(bundle.content).toContain("result of `memory catalog show` at injection time");
    expect(bundle.content).toContain("prefer `memory catalog diff`");
    expect(bundle.content).toContain("instead of reflexively rerunning `memory catalog show`");
    expect(bundle.content).toContain("inspect the actual Markdown files directly");

    await expect(
      readFile(join(root, ".git", "takode-memory-catalog-seen", "session-a.json"), "utf-8"),
    ).rejects.toThrow();
    await bundle.recordSeen?.();

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
    expect(bundle.content).toContain("The preloaded content is truncated");
    expect(bundle.content).toContain("for freshness since this injection, use `memory catalog diff`");
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
    expect(bundle.content).toContain("attempted to create a `memory catalog show` snapshot");
  });

  it("reports a stage-specific scan timeout without advancing freshness later", async () => {
    vi.useFakeTimers();
    let resolveCatalog!: (catalog: MemoryCatalog) => void;
    const catalog = new Promise<MemoryCatalog>((resolve) => {
      resolveCatalog = resolve;
    });
    const markCatalogSeen = vi.fn(async () => {});
    const logger = { info: vi.fn(), warn: vi.fn() };

    const building = buildMemoryCatalogInjectionBundle({
      sessionId: "session-timeout",
      timeoutMs: 100,
      catalog: async () => catalog,
      markCatalogSeen,
      logger,
    });
    await vi.advanceTimersByTimeAsync(100);
    const bundle = await building;

    expect(bundle.unavailable).toBe(true);
    expect(bundle.content).toContain("memory catalog scan timed out after 100ms");
    expect(bundle.recordSeen).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Catalog scan failed for session session-timeout"),
    );

    // A non-cancelling deadline may let the underlying read settle later, but
    // an unavailable injection must never advance the session's seen watermark.
    resolveCatalog(catalogFixture());
    await Promise.resolve();
    expect(markCatalogSeen).not.toHaveBeenCalled();
  });

  it("keeps a delivered catalog available when freshness watermark persistence times out", async () => {
    vi.useFakeTimers();
    const logger = { info: vi.fn(), warn: vi.fn() };
    const markCatalogSeen = vi.fn(() => new Promise<void>(() => {}));
    const bundle = await buildMemoryCatalogInjectionBundle({
      sessionId: "session-slow-seen",
      timeoutMs: 100,
      catalog: async () => catalogFixture(),
      markCatalogSeen,
      logger,
    });

    expect(bundle.unavailable).toBe(false);
    expect(markCatalogSeen).not.toHaveBeenCalled();

    const recording = bundle.recordSeen?.();
    expect(markCatalogSeen).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    await recording;

    expect(bundle.content).not.toContain(MEMORY_CATALOG_UNAVAILABLE_PREFIX);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Freshness watermark update failed"));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("freshness watermark update timed out after 100ms"),
    );
    await bundle.recordSeen?.();
    expect(markCatalogSeen).toHaveBeenCalledTimes(1);
  });

  it("never records an unavailable catalog as seen", () => {
    const recordSeen = vi.fn(async () => {});

    recordMemoryCatalogSeenAfterDelivery({
      ...buildUnavailableMemoryCatalogBundle(new Error("scan failed")),
      recordSeen,
    });

    expect(recordSeen).not.toHaveBeenCalled();
  });

  it("can build an unavailable warning directly for recovery fallback paths", () => {
    const bundle = buildUnavailableMemoryCatalogBundle(new Error("boom"), { limit: 1_000 });

    expect(bundle.agentSource.sessionId).toBe(MEMORY_CATALOG_SOURCE_ID);
    expect(bundle.content).toContain(MEMORY_CATALOG_UNAVAILABLE_PREFIX);
    expect(bundle.content).toContain("boom");
  });
});
