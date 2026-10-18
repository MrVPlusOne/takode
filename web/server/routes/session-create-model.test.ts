import { describe, expect, it, vi } from "vitest";
import { createSessionCreateModelResolver, resolveSessionCreateModel } from "./session-create-model.js";

function makeLauncher(
  session:
    | {
        backendType?: "codex" | "claude-sdk";
        model?: string;
      }
    | undefined = undefined,
) {
  return {
    getSession: vi.fn(() => session),
    resolveSessionId: vi.fn((id: string) => id),
  };
}

describe("resolveSessionCreateModel", () => {
  it("inherits the creator model for same-backend spawns when no explicit model is provided", async () => {
    const launcher = makeLauncher({ backendType: "codex", model: "gpt-5.5" });

    await expect(
      resolveSessionCreateModel({
        backend: "codex",
        createdBy: "leader-1",
        getClaudeUserDefaultModel: vi.fn(async () => "claude-default"),
        getCodexUserDefaultModel: vi.fn(async () => ""),
        launcher,
      }),
    ).resolves.toMatchObject({
      model: "gpt-5.5",
      modelAuthority: { source: "inherited_session" },
    });
  });

  it("falls back to the target backend default for cross-backend spawns", async () => {
    const getClaudeUserDefaultModel = vi.fn(async () => "claude-default");
    const launcher = makeLauncher({ backendType: "codex", model: "gpt-5.5" });

    await expect(
      resolveSessionCreateModel({
        backend: "claude-sdk",
        createdBy: "leader-1",
        getClaudeUserDefaultModel,
        getCodexUserDefaultModel: vi.fn(async () => ""),
        launcher,
      }),
    ).resolves.toEqual({ model: "claude-default" });
    expect(getClaudeUserDefaultModel).toHaveBeenCalledTimes(1);
  });

  it("preserves an explicit model override", async () => {
    const launcher = makeLauncher({ backendType: "codex", model: "gpt-5.5" });

    await expect(
      resolveSessionCreateModel({
        backend: "claude-sdk",
        createdBy: "leader-1",
        getClaudeUserDefaultModel: vi.fn(async () => "claude-default"),
        getCodexUserDefaultModel: vi.fn(async () => ""),
        launcher,
        requestedModel: "custom-model",
      }),
    ).resolves.toEqual({ model: "custom-model" });
  });

  it("records the configured default above the managed fallback", async () => {
    const launcher = makeLauncher();

    await expect(
      resolveSessionCreateModel({
        backend: "codex",
        configuredDefaultModel: "gpt-5.6-terra",
        getClaudeUserDefaultModel: vi.fn(async () => "claude-default"),
        getCodexUserDefaultModel: vi.fn(async () => ""),
        launcher,
      }),
    ).resolves.toMatchObject({
      model: "gpt-5.6-terra",
      modelAuthority: {
        source: "session_default",
        overrideTrace: [
          { source: "session_default", status: "selected" },
          { source: "managed_fallback", model: "gpt-5.6-sol", status: "overridden" },
        ],
      },
    });
  });

  it("uses the managed Codex default when no higher authority exists", async () => {
    const launcher = makeLauncher();

    await expect(
      resolveSessionCreateModel({
        backend: "codex",
        getClaudeUserDefaultModel: vi.fn(async () => "claude-default"),
        getCodexUserDefaultModel: vi.fn(async () => ""),
        launcher,
      }),
    ).resolves.toMatchObject({
      model: "gpt-5.6-sol",
      modelAuthority: { source: "managed_fallback" },
    });
  });

  it("marks unknown external resume provenance while choosing the configured default", async () => {
    const resolver = createSessionCreateModelResolver({
      launcher: makeLauncher(),
      getClaudeUserDefaultModel: async () => "",
      getCodexUserDefaultModel: async () => "",
    });

    await expect(
      resolver.forResume("codex", {}, { sessionDefaults: { codex: { model: "gpt-5.6-terra" } } }, undefined),
    ).resolves.toMatchObject({
      model: "gpt-5.6-terra",
      modelAuthority: { source: "session_default" },
      modelProvenanceMigrationCreated: true,
      modelProvenanceMigration: {
        source: "external_resume",
        selectedModel: "gpt-5.6-terra",
      },
    });
  });

  it("resolves an explicit Codex Default from the Codex config, not a saved or inherited model", async () => {
    // The picker labels "Default" from the Codex config; a saved session default
    // or the creator's model must not silently replace that choice.
    const launcher = makeLauncher({ backendType: "codex", model: "gpt-5.4" });

    await expect(
      resolveSessionCreateModel({
        backend: "codex",
        createdBy: "leader-1",
        configuredDefaultModel: "gpt-5.5",
        getClaudeUserDefaultModel: vi.fn(async () => ""),
        getCodexUserDefaultModel: vi.fn(async () => "gpt-5.6-terra"),
        launcher,
        requestedModel: "",
      }),
    ).resolves.toMatchObject({
      model: "gpt-5.6-terra",
      modelAuthority: {
        source: "codex_default",
        overrideTrace: [
          { source: "codex_default", status: "selected" },
          { source: "managed_fallback", status: "overridden" },
        ],
      },
    });
  });

  it("uses the managed Codex default for an explicit Default when the Codex config sets no model", async () => {
    await expect(
      resolveSessionCreateModel({
        backend: "codex",
        configuredDefaultModel: "gpt-5.5",
        getClaudeUserDefaultModel: vi.fn(async () => ""),
        getCodexUserDefaultModel: vi.fn(async () => ""),
        launcher: makeLauncher(),
        requestedModel: "",
      }),
    ).resolves.toMatchObject({ model: "gpt-5.6-sol", modelAuthority: { source: "managed_fallback" } });
  });

  it("treats an explicit Default on resume as known provenance", async () => {
    const resolver = createSessionCreateModelResolver({
      launcher: makeLauncher(),
      getClaudeUserDefaultModel: async () => "",
      getCodexUserDefaultModel: async () => "gpt-5.6-terra",
    });

    const resolved = await resolver.forResume("codex", {}, {}, "");
    expect(resolved).toMatchObject({ model: "gpt-5.6-terra", modelAuthority: { source: "codex_default" } });
    expect(resolved.modelProvenanceMigration).toBeUndefined();
  });
});
