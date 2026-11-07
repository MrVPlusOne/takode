import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { forgetKeptMemoryCatalogs, keptMemoryCatalog } from "./memory-catalog-cache.js";

// The catalog injected at session start used to be scanned on demand inside the busy server, where it missed its
// 3 s deadline. These tests check when the kept catalog is reused, rescanned, refreshed and used as a fallback.

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function repo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "memory-catalog-cache-"));
  roots.push(root);
  await note(root, "topic/first.md");
  return root;
}

async function note(root: string, path: string): Promise<void> {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(
    join(root, path),
    `---\ndescription: ${path}\nupdated: 2026-11-06\ntype: knowledge\n---\n\nBody.\n`,
    "utf-8",
  );
}

const paths = (catalog: { entries: { path: string }[] }) => catalog.entries.map((entry) => entry.path);

it("reuses the kept catalog until a memory write, then scans again", async () => {
  const root = await repo();
  expect(paths(await keptMemoryCatalog({ root, readOnly: true }))).toEqual(["topic/first.md"]);

  // A note changed outside the server is not seen yet: no scan runs while the kept catalog is fresh.
  await note(root, "topic/second.md");
  expect(paths(await keptMemoryCatalog({ root, readOnly: true }))).toEqual(["topic/first.md"]);

  forgetKeptMemoryCatalogs();
  expect(paths(await keptMemoryCatalog({ root, readOnly: true }))).toEqual(["topic/first.md", "topic/second.md"]);
});

it("returns an old catalog at once and refreshes it in the background", async () => {
  const root = await repo();
  let now = 1_000_000;
  await keptMemoryCatalog({ root, readOnly: true }, {}, () => now);
  await note(root, "topic/second.md");

  now += 61_000;
  expect(paths(await keptMemoryCatalog({ root, readOnly: true }, {}, () => now))).toEqual(["topic/first.md"]);
  await vi.waitFor(async () =>
    expect(paths(await keptMemoryCatalog({ root, readOnly: true }, {}, () => now))).toEqual([
      "topic/first.md",
      "topic/second.md",
    ]),
  );
});

it("falls back to the stale catalog when the rescan after a write times out", async () => {
  const root = await repo();
  await keptMemoryCatalog({ root, readOnly: true });
  forgetKeptMemoryCatalogs();
  const hanging = (_path: string, signal?: AbortSignal) =>
    new Promise<string>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason)));

  const catalog = await keptMemoryCatalog({ root, readOnly: true }, { readFile: hanging, timeoutMs: 20 });
  expect(paths(catalog)).toEqual(["topic/first.md"]);
  // Without a kept catalog the failure is reported, so the caller can say the catalog is unavailable.
  const fresh = await repo();
  await expect(
    keptMemoryCatalog({ root: fresh, readOnly: true }, { readFile: hanging, timeoutMs: 20 }),
  ).rejects.toThrow(/timed out/);
});
