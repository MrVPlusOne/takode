import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempDir: string;
let envManager: typeof import("./env-manager.js");

const mockHomedir = vi.hoisted(() => {
  let dir = "";
  return {
    get: () => dir,
    set: (d: string) => {
      dir = d;
    },
  };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => mockHomedir.get(),
  };
});

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "env-test-"));
  mockHomedir.set(tempDir);
  vi.resetModules();
  envManager = await import("./env-manager.js");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper to get the envs directory path used by the module
// ---------------------------------------------------------------------------
function envsDir(): string {
  return join(tempDir, ".companion", "envs");
}

// ===========================================================================
// Slugification (tested indirectly via createEnv)
// ===========================================================================
describe("slugification via createEnv", () => {
  it("converts spaces to hyphens and lowercases", async () => {
    const env = await envManager.createEnv("My App");
    expect(env.slug).toBe("my-app");
  });

  it("strips special characters", async () => {
    const env = await envManager.createEnv("Hello World! @#$%");
    expect(env.slug).toBe("hello-world");
  });

  it("collapses consecutive hyphens", async () => {
    const env = await envManager.createEnv("a   ---  b");
    expect(env.slug).toBe("a-b");
  });

  it("trims leading and trailing hyphens", async () => {
    const env = await envManager.createEnv(" -cool env- ");
    expect(env.slug).toBe("cool-env");
  });

  it("throws when name is empty string", async () => {
    await expect(envManager.createEnv("")).rejects.toThrow("Environment name is required");
  });

  it("throws when name is only whitespace", async () => {
    await expect(envManager.createEnv("   ")).rejects.toThrow("Environment name is required");
  });

  it("throws when name contains no alphanumeric characters", async () => {
    await expect(envManager.createEnv("@#$%^&")).rejects.toThrow(
      "Environment name must contain alphanumeric characters",
    );
  });
});

// ===========================================================================
// listEnvs
// ===========================================================================
describe("listEnvs", () => {
  it("returns empty array when no envs exist", async () => {
    const result = await envManager.listEnvs();
    expect(result).toEqual([]);
  });

  it("returns envs sorted alphabetically by name", async () => {
    await envManager.createEnv("Zebra");
    await envManager.createEnv("Alpha");
    await envManager.createEnv("Mango");

    const result = await envManager.listEnvs();
    expect(result.map((e) => e.name)).toEqual(["Alpha", "Mango", "Zebra"]);
  });

  it("skips corrupt JSON files", async () => {
    // Create a valid env first
    await envManager.createEnv("Valid");

    // Write a corrupt file directly into the envs directory
    writeFileSync(join(envsDir(), "corrupt.json"), "NOT VALID JSON{{{", "utf-8");

    const result = await envManager.listEnvs();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Valid");
  });
});

// ===========================================================================
// getEnv
// ===========================================================================
describe("getEnv", () => {
  it("returns the env when it exists", async () => {
    await envManager.createEnv("My Service", { PORT: "3000" });

    const result = await envManager.getEnv("my-service");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("My Service");
    expect(result!.slug).toBe("my-service");
    expect(result!.variables).toEqual({ PORT: "3000" });
  });

  it("returns null when the env does not exist", async () => {
    const result = await envManager.getEnv("nonexistent");
    expect(result).toBeNull();
  });
});

// ===========================================================================
// createEnv
// ===========================================================================
describe("createEnv", () => {
  it("returns an env with correct structure and timestamps", async () => {
    const before = Date.now();
    const env = await envManager.createEnv("Production", { NODE_ENV: "production" });
    const after = Date.now();

    expect(env.name).toBe("Production");
    expect(env.slug).toBe("production");
    expect(env.variables).toEqual({ NODE_ENV: "production" });
    expect(env.createdAt).toBeGreaterThanOrEqual(before);
    expect(env.createdAt).toBeLessThanOrEqual(after);
    expect(env.updatedAt).toBe(env.createdAt);
  });

  it("persists the env to disk as JSON", async () => {
    await envManager.createEnv("Disk Check");

    const raw = readFileSync(join(envsDir(), "disk-check.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.name).toBe("Disk Check");
    expect(parsed.slug).toBe("disk-check");
  });

  it("defaults variables to empty object", async () => {
    const env = await envManager.createEnv("No Vars");
    expect(env.variables).toEqual({});
  });

  it("throws when creating a duplicate slug", async () => {
    await envManager.createEnv("My App");
    await expect(envManager.createEnv("My App")).rejects.toThrow(
      'An environment with a similar name already exists ("my-app")',
    );
  });

  it("trims the name before saving", async () => {
    const env = await envManager.createEnv("  Spaced Out  ");
    expect(env.name).toBe("Spaced Out");
    expect(env.slug).toBe("spaced-out");
  });
});

// ===========================================================================
// updateEnv
// ===========================================================================
describe("updateEnv", () => {
  it("updates name and variables", async () => {
    await envManager.createEnv("Original", { KEY: "old" });

    const updated = await envManager.updateEnv("original", {
      name: "Renamed",
      variables: { KEY: "new" },
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Renamed");
    expect(updated!.slug).toBe("renamed");
    expect(updated!.variables).toEqual({ KEY: "new" });
  });

  it("renames the file on disk when slug changes", async () => {
    await envManager.createEnv("Old Name");

    await envManager.updateEnv("old-name", { name: "New Name" });

    // Old file should be gone, new file should exist
    const oldPath = join(envsDir(), "old-name.json");
    const newPath = join(envsDir(), "new-name.json");

    expect(() => readFileSync(oldPath, "utf-8")).toThrow();
    const parsed = JSON.parse(readFileSync(newPath, "utf-8"));
    expect(parsed.name).toBe("New Name");
    expect(parsed.slug).toBe("new-name");
  });

  it("throws on slug collision during rename", async () => {
    await envManager.createEnv("Alpha");
    await envManager.createEnv("Beta");

    await expect(envManager.updateEnv("alpha", { name: "Beta" })).rejects.toThrow(
      'An environment with a similar name already exists ("beta")',
    );
  });

  it("returns null for a non-existent slug", async () => {
    const result = await envManager.updateEnv("ghost", { name: "New" });
    expect(result).toBeNull();
  });

  it("preserves createdAt and advances updatedAt", async () => {
    const env = await envManager.createEnv("Timestamps");
    const originalCreatedAt = env.createdAt;

    // Small delay to ensure Date.now() advances
    await new Promise((r) => setTimeout(r, 10));

    const updated = await envManager.updateEnv("timestamps", { variables: { A: "1" } });

    expect(updated).not.toBeNull();
    expect(updated!.createdAt).toBe(originalCreatedAt);
    expect(updated!.updatedAt).toBeGreaterThan(originalCreatedAt);
  });

  it("keeps existing variables when only name is updated", async () => {
    await envManager.createEnv("Keep Vars", { SECRET: "abc" });

    const updated = await envManager.updateEnv("keep-vars", { name: "Kept Vars" });
    expect(updated!.variables).toEqual({ SECRET: "abc" });
  });
});

// ===========================================================================
// deleteEnv
// ===========================================================================
describe("deleteEnv", () => {
  it("deletes an existing env and returns true", async () => {
    await envManager.createEnv("To Delete");
    const result = await envManager.deleteEnv("to-delete");
    expect(result).toBe(true);

    // Confirm it is gone
    expect(await envManager.getEnv("to-delete")).toBeNull();
  });

  it("returns false when the env does not exist", async () => {
    const result = await envManager.deleteEnv("missing");
    expect(result).toBe(false);
  });
});
