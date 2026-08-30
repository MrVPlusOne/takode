import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTakodeBuildManifest,
  generateTakodeBuildId,
  getTakodeProcessBuildId,
  normalizeTakodeBuildId,
  readTakodeBuildManifest,
  serializeTakodeBuildManifest,
  TAKODE_BUILD_MANIFEST_FILENAME,
  TAKODE_DEVELOPMENT_BUILD_ID,
} from "./build-identity.js";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "takode-build-identity-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Takode build identities", () => {
  it("normalizes bounded opaque IDs and rejects unsafe values", () => {
    expect(normalizeTakodeBuildId("  build-123.example_4  ")).toBe("build-123.example_4");
    expect(normalizeTakodeBuildId(42)).toBeNull();
    expect(normalizeTakodeBuildId("contains spaces")).toBeNull();
    expect(normalizeTakodeBuildId("../escape")).toBeNull();
    expect(normalizeTakodeBuildId(`build-${"x".repeat(128)}`)).toBeNull();
  });

  it("generates a normalized production build ID", () => {
    const buildId = generateTakodeBuildId(() => "00000000-0000-4000-8000-000000000000");
    expect(buildId).toBe("build-00000000-0000-4000-8000-000000000000");
    expect(normalizeTakodeBuildId(buildId)).toBe(buildId);
  });

  it("reads the small versioned manifest emitted with a frontend build", async () => {
    const root = await makeTempRoot();
    await mkdir(root, { recursive: true });
    await writeFile(join(root, TAKODE_BUILD_MANIFEST_FILENAME), serializeTakodeBuildManifest("build-test"));

    await expect(readTakodeBuildManifest(root)).resolves.toEqual(createTakodeBuildManifest("build-test"));
  });

  it("rejects malformed, unsupported, and oversized manifests", async () => {
    const root = await makeTempRoot();
    const manifestPath = join(root, TAKODE_BUILD_MANIFEST_FILENAME);

    await writeFile(manifestPath, "{bad json");
    await expect(readTakodeBuildManifest(root)).rejects.toThrow("not valid JSON");

    await writeFile(manifestPath, JSON.stringify({ version: 2, buildId: "build-test" }));
    await expect(readTakodeBuildManifest(root)).rejects.toThrow("unsupported shape");

    await writeFile(manifestPath, "x".repeat(4097));
    await expect(readTakodeBuildManifest(root)).rejects.toThrow("too large");
  });

  it("uses one stable development ID and requires an explicit production ID", () => {
    expect(getTakodeProcessBuildId({ NODE_ENV: "development" })).toBe(TAKODE_DEVELOPMENT_BUILD_ID);
    expect(getTakodeProcessBuildId({ NODE_ENV: "test", TAKODE_BUILD_ID: "build-stale" })).toBe(
      TAKODE_DEVELOPMENT_BUILD_ID,
    );
    expect(getTakodeProcessBuildId({ NODE_ENV: "production", TAKODE_BUILD_ID: " build-live " })).toBe("build-live");
    expect(getTakodeProcessBuildId({ NODE_ENV: "production" })).toBeNull();
  });
});
