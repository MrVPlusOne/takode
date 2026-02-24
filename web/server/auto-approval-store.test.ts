import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  listConfigs,
  getConfig,
  getConfigForPath,
  createConfig,
  updateConfig,
  deleteConfig,
  slugFromPath,
  _setStoreDirForTest,
  _resetStoreDir,
} from "./auto-approval-store.js";

describe("auto-approval-store", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "auto-approval-test-"));
    _setStoreDirForTest(testDir);
  });

  afterEach(() => {
    _resetStoreDir();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  describe("slugFromPath", () => {
    it("generates deterministic slugs from paths", () => {
      const slug1 = slugFromPath("/home/user/project");
      const slug2 = slugFromPath("/home/user/project");
      expect(slug1).toBe(slug2);
      expect(slug1).toHaveLength(12);
    });

    it("generates different slugs for different paths", () => {
      const slug1 = slugFromPath("/home/user/project-a");
      const slug2 = slugFromPath("/home/user/project-b");
      expect(slug1).not.toBe(slug2);
    });
  });

  describe("CRUD operations", () => {
    it("creates a config and retrieves it", () => {
      const config = createConfig("/home/user/project", "My Project", "Allow all reads", true);
      expect(config.projectPath).toBe("/home/user/project");
      expect(config.label).toBe("My Project");
      expect(config.criteria).toBe("Allow all reads");
      expect(config.enabled).toBe(true);
      expect(config.slug).toBe(slugFromPath("/home/user/project"));

      const retrieved = getConfig(config.slug);
      expect(retrieved).toEqual(config);
    });

    it("lists all configs sorted by label", () => {
      createConfig("/path/b", "Bravo", "criteria b");
      createConfig("/path/a", "Alpha", "criteria a");
      createConfig("/path/c", "Charlie", "criteria c");

      const configs = listConfigs();
      expect(configs).toHaveLength(3);
      expect(configs[0].label).toBe("Alpha");
      expect(configs[1].label).toBe("Bravo");
      expect(configs[2].label).toBe("Charlie");
    });

    it("returns empty list when no configs exist", () => {
      expect(listConfigs()).toEqual([]);
    });

    it("returns null for non-existent config", () => {
      expect(getConfig("nonexistent")).toBeNull();
    });

    it("prevents duplicate project paths", () => {
      createConfig("/home/user/project", "First", "criteria");
      expect(() => createConfig("/home/user/project", "Second", "criteria")).toThrow(
        "already exists",
      );
    });

    it("requires project path", () => {
      expect(() => createConfig("", "Label", "criteria")).toThrow("Project path is required");
    });

    it("requires label", () => {
      expect(() => createConfig("/path", "", "criteria")).toThrow("Label is required");
    });

    it("trims whitespace from fields", () => {
      const config = createConfig("  /home/user/project  ", "  My Project  ", "  criteria  ");
      // Note: projectPath only trims, doesn't add back trailing slash
      expect(config.label).toBe("My Project");
      expect(config.criteria).toBe("criteria");
    });

    it("normalizes trailing slashes on project path", () => {
      const config = createConfig("/home/user/project/", "Label", "criteria");
      expect(config.projectPath).toBe("/home/user/project");
    });

    it("updates config fields", () => {
      const config = createConfig("/path", "Original", "original criteria", true);
      const updated = updateConfig(config.slug, {
        label: "Updated",
        criteria: "new criteria",
        enabled: false,
      });

      expect(updated).not.toBeNull();
      expect(updated!.label).toBe("Updated");
      expect(updated!.criteria).toBe("new criteria");
      expect(updated!.enabled).toBe(false);
      expect(updated!.projectPath).toBe("/path"); // unchanged
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(config.updatedAt);
    });

    it("updates only specified fields", () => {
      const config = createConfig("/path", "Label", "criteria", true);
      const updated = updateConfig(config.slug, { label: "New Label" });

      expect(updated!.label).toBe("New Label");
      expect(updated!.criteria).toBe("criteria"); // unchanged
      expect(updated!.enabled).toBe(true); // unchanged
    });

    it("returns null when updating non-existent config", () => {
      expect(updateConfig("nonexistent", { label: "test" })).toBeNull();
    });

    it("deletes a config", () => {
      const config = createConfig("/path", "Label", "criteria");
      expect(deleteConfig(config.slug)).toBe(true);
      expect(getConfig(config.slug)).toBeNull();
    });

    it("returns false when deleting non-existent config", () => {
      expect(deleteConfig("nonexistent")).toBe(false);
    });
  });

  describe("getConfigForPath — longest prefix matching", () => {
    it("matches exact path", () => {
      createConfig("/home/user/project", "Project", "criteria");
      const match = getConfigForPath("/home/user/project");
      expect(match).not.toBeNull();
      expect(match!.projectPath).toBe("/home/user/project");
    });

    it("matches subdirectory", () => {
      createConfig("/home/user/project", "Project", "criteria");
      const match = getConfigForPath("/home/user/project/src/components");
      expect(match).not.toBeNull();
      expect(match!.projectPath).toBe("/home/user/project");
    });

    it("uses longest prefix match", () => {
      createConfig("/home/user", "Home", "home criteria");
      createConfig("/home/user/project", "Project", "project criteria");

      const match = getConfigForPath("/home/user/project/src");
      expect(match).not.toBeNull();
      expect(match!.projectPath).toBe("/home/user/project");
      expect(match!.criteria).toBe("project criteria");
    });

    it("returns null when no config matches", () => {
      createConfig("/home/user/project-a", "A", "criteria");
      expect(getConfigForPath("/home/user/project-b")).toBeNull();
    });

    it("does not match partial directory names", () => {
      // /home/user/proj should NOT match a config for /home/user/project
      createConfig("/home/user/project", "Project", "criteria");
      expect(getConfigForPath("/home/user/proj")).toBeNull();
    });

    it("skips disabled configs", () => {
      createConfig("/home/user/project", "Project", "criteria", false);
      expect(getConfigForPath("/home/user/project")).toBeNull();
    });

    it("handles trailing slashes in cwd", () => {
      createConfig("/home/user/project", "Project", "criteria");
      const match = getConfigForPath("/home/user/project/");
      expect(match).not.toBeNull();
      expect(match!.projectPath).toBe("/home/user/project");
    });
  });
});
