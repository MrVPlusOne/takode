import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function importImageStoreWithBlockedSharp() {
  vi.resetModules();
  vi.doMock("sharp", () => {
    throw new Error("sharp should not load during image-store module evaluation");
  });

  try {
    return await import("./image-store.js");
  } finally {
    vi.doUnmock("sharp");
  }
}

afterEach(() => {
  vi.doUnmock("sharp");
  vi.resetModules();
});

describe("image-store module loading", () => {
  it("imports and constructs ImageStore without loading sharp", async () => {
    const imageStore = await importImageStoreWithBlockedSharp();
    const tempDir = mkdtempSync(join(tmpdir(), "image-store-module-load-"));

    try {
      expect(imageStore.SharpUnavailableError).toBeDefined();
      expect(() => new imageStore.ImageStore(tempDir)).not.toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
