import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getClaudeModelCatalog, mapClaudeCatalogModels, recordClaudeModelCatalog } from "./claude-model-catalog.js";

// Shape reported by Claude Code 2.1.289's `supportedModels()` for a Copilot
// gateway setup whose settings map the Opus and Haiku aliases to dotted IDs.
const EFFORT = { supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] };
const CLI_CATALOG = [
  {
    value: "default",
    resolvedModel: "claude-opus-5.5",
    displayName: "Default (recommended)",
    description: "Use the default model (currently Opus 5) · $5/$25 per Mtok",
    ...EFFORT,
  },
  {
    value: "opus",
    resolvedModel: "claude-opus-5.5",
    displayName: "claude-opus-5.5",
    description: "Custom Opus model",
    ...EFFORT,
  },
  { value: "fable", resolvedModel: "claude-fable-5-1", displayName: "Fable", description: "Fable 5.1", ...EFFORT },
  { value: "sonnet", resolvedModel: "claude-sonnet-5-5", displayName: "Sonnet", description: "Sonnet 5.5", ...EFFORT },
  // Haiku has no effort control, so the CLI reports no effort fields for it.
  {
    value: "haiku",
    resolvedModel: "claude-haiku-4.5",
    displayName: "claude-haiku-4.5",
    description: "Custom Haiku model",
  },
];
const LEVELS = EFFORT.supportedEffortLevels.map((effort) => ({ effort }));

describe("mapClaudeCatalogModels", () => {
  it("keys options by resolved model and folds aliases of the default model into one entry", () => {
    // Selecting an option must send the concrete model the CLI would use, and
    // the `opus` alias resolving to the same model as `default` must not
    // produce a duplicate menu entry.
    expect(mapClaudeCatalogModels(CLI_CATALOG)).toEqual([
      {
        value: "claude-opus-5.5",
        label: "Opus 5.5 (default)",
        description: "Use the default model (currently Opus 5) · $5/$25 per Mtok",
        isDefault: true,
        supportedReasoningLevels: LEVELS,
      },
      { value: "claude-fable-5-1", label: "Fable 5.1", description: "Fable 5.1", supportedReasoningLevels: LEVELS },
      { value: "claude-sonnet-5-5", label: "Sonnet 5.5", description: "Sonnet 5.5", supportedReasoningLevels: LEVELS },
      {
        value: "claude-haiku-4.5",
        label: "Haiku 4.5",
        description: "Custom Haiku model",
        supportedReasoningLevels: [],
      },
    ]);
  });

  it("falls back to the alias and display name when the CLI does not report a resolved model", () => {
    // Older CLIs omit `resolvedModel`; the alias itself is still a valid model value.
    expect(
      mapClaudeCatalogModels([
        { value: "default", displayName: "Default (recommended)", description: "" },
        { value: "sonnet[1m]", displayName: "Sonnet (1M context)", description: "" },
      ]),
    ).toEqual([
      {
        value: "default",
        label: "Default (recommended)",
        description: "",
        isDefault: true,
        supportedReasoningLevels: [],
      },
      { value: "sonnet[1m]", label: "Sonnet (1M context)", description: "", supportedReasoningLevels: [] },
    ]);
  });

  it("formats dated and context-tagged model IDs", () => {
    expect(
      mapClaudeCatalogModels([
        { value: "a", resolvedModel: "claude-sonnet-4-5-20250929" },
        { value: "b", resolvedModel: "claude-opus-4-6[1m]" },
      ]).map((model) => model.label),
    ).toEqual(["Sonnet 4.5", "Opus 4.6 [1M]"]);
  });

  it("ignores malformed entries", () => {
    expect(mapClaudeCatalogModels(null)).toEqual([]);
    expect(mapClaudeCatalogModels([null, { value: "" }, { displayName: "x" }])).toEqual([]);
  });
});

describe("recordClaudeModelCatalog", () => {
  it("keeps the last usable catalog when a later report is empty", () => {
    // A session whose initialization returns nothing must not erase a catalog
    // another session already reported.
    recordClaudeModelCatalog(CLI_CATALOG);
    recordClaudeModelCatalog([]);
    expect(getClaudeModelCatalog()?.map((model) => model.value)).toEqual([
      "claude-opus-5.5",
      "claude-fable-5-1",
      "claude-sonnet-5-5",
      "claude-haiku-4.5",
    ]);
  });
});

describe("saved catalog across restarts", () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  /** A fresh copy of the module, as a restarted server has, plus a disposable save path. */
  async function freshServer(dir?: string) {
    vi.resetModules();
    const catalog = await import("./claude-model-catalog.js");
    const root = dir ?? (await mkdtemp(join(tmpdir(), "claude-model-catalog-")));
    if (!dir) tempDirs.push(root);
    return { catalog, root, path: join(root, "nested", "claude-model-catalog.json") };
  }

  it("serves the catalog reported before a restart until a session reports a new one", async () => {
    // The bug: after a restart the model menu fell back to generic aliases,
    // hiding gateway models such as Fable 5.2, until some Claude session initialized.
    const before = await freshServer();
    await before.catalog.loadClaudeModelCatalog(before.path);
    before.catalog.recordClaudeModelCatalog(CLI_CATALOG);
    await before.catalog._flushClaudeModelCatalogForTest();

    const after = await freshServer(before.root);
    expect(after.catalog.getClaudeModelCatalog()).toBeNull();
    await after.catalog.loadClaudeModelCatalog(before.path);
    expect(after.catalog.getClaudeModelCatalog()).toEqual(mapClaudeCatalogModels(CLI_CATALOG));

    // A fresh report replaces the saved one and is saved in turn.
    const fresh = [{ value: "default", resolvedModel: "claude-fable-5.2", ...EFFORT }];
    after.catalog.recordClaudeModelCatalog(fresh);
    await after.catalog._flushClaudeModelCatalogForTest();
    expect(after.catalog.getClaudeModelCatalog()?.map((model) => model.value)).toEqual(["claude-fable-5.2"]);
    expect(JSON.parse(await readFile(before.path, "utf-8"))).toEqual({ models: fresh });
  });

  it("keeps a report recorded while the saved file is being read", async () => {
    // A session can initialize during startup; its catalog is newer than the file.
    const server = await freshServer();
    await writeFile(join(server.root, "saved.json"), JSON.stringify({ models: CLI_CATALOG }));
    const loading = server.catalog.loadClaudeModelCatalog(join(server.root, "saved.json"));
    server.catalog.recordClaudeModelCatalog([{ value: "default", resolvedModel: "claude-opus-5.5" }]);
    await loading;
    expect(server.catalog.getClaudeModelCatalog()?.map((model) => model.value)).toEqual(["claude-opus-5.5"]);
  });

  it("starts without a catalog when nothing usable was saved", async () => {
    // The route then answers 404 and menus use their static aliases.
    const server = await freshServer();
    await server.catalog.loadClaudeModelCatalog(join(server.root, "missing.json"));
    expect(server.catalog.getClaudeModelCatalog()).toBeNull();
    await writeFile(join(server.root, "broken.json"), "{not json");
    await server.catalog.loadClaudeModelCatalog(join(server.root, "broken.json"));
    expect(server.catalog.getClaudeModelCatalog()).toBeNull();
  });
});

describe("resolveClaudeModelCatalog", () => {
  afterEach(() => {
    vi.doUnmock("@anthropic-ai/claude-agent-sdk");
    vi.useRealTimers();
  });

  /** A fresh module with nothing recorded, as a new install has. */
  async function freshCatalog() {
    vi.resetModules();
    return import("./claude-model-catalog.js");
  }

  it("asks Claude Code once for every caller waiting while nothing is known, then records the answer", async () => {
    // A new user's first New Session menu would otherwise show generic aliases
    // until some Claude session started.
    const catalog = await freshCatalog();
    let answer!: (models: unknown) => void;
    const probe = vi.fn(() => new Promise<unknown>((resolve) => (answer = resolve)));
    const first = catalog.resolveClaudeModelCatalog(probe);
    const second = catalog.resolveClaudeModelCatalog(probe);
    answer(CLI_CATALOG);
    expect(await first).toEqual(mapClaudeCatalogModels(CLI_CATALOG));
    expect(await second).toEqual(mapClaudeCatalogModels(CLI_CATALOG));
    expect(probe).toHaveBeenCalledTimes(1);
    // Known now, so later callers don't start Claude Code again.
    expect(await catalog.resolveClaudeModelCatalog(probe)).toEqual(mapClaudeCatalogModels(CLI_CATALOG));
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("answers null when the probe fails, and tries again on the next call", async () => {
    // The route then answers 404 and menus keep their static aliases.
    const catalog = await freshCatalog();
    const failing = vi.fn(() => Promise.reject(new Error("spawn ENOENT")));
    expect(await catalog.resolveClaudeModelCatalog(failing)).toBeNull();
    expect(await catalog.resolveClaudeModelCatalog(() => Promise.resolve(CLI_CATALOG))).toEqual(
      mapClaudeCatalogModels(CLI_CATALOG),
    );
  });

  it("starts this machine's Claude program, reads its catalog and stops it", async () => {
    // The probe must launch the same Claude Code sessions use, or the menu would
    // list another CLI's models, and must never leave the process running.
    const close = vi.fn();
    const query = vi.fn(() => ({ supportedModels: () => Promise.resolve(CLI_CATALOG), close }));
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({ query }));
    const catalog = await freshCatalog();
    const machines = await import("./remote-host/machine-settings.js");
    machines.configureMachineSettings({
      machineSettings: () => ({ claudeBinary: "/opt/claude-launcher", codexBinary: "", worktreeRoot: "" }),
    });
    try {
      expect(await catalog.resolveClaudeModelCatalog()).toEqual(mapClaudeCatalogModels(CLI_CATALOG));
    } finally {
      machines.configureMachineSettings(null);
    }
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ pathToClaudeCodeExecutable: "/opt/claude-launcher" }),
      }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("stops a Claude process that never answers", async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: () => ({ supportedModels: () => new Promise(() => {}), close }),
    }));
    const catalog = await freshCatalog();
    const result = catalog.resolveClaudeModelCatalog();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await result).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
