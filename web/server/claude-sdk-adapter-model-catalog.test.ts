import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getClaudeModelCatalog } from "./claude-model-catalog.js";
import { ClaudeSdkAdapter } from "./claude-sdk-adapter.js";

// A stand-in Claude CLI speaking the SDK's stream-json control protocol: it
// answers every control request successfully and reports a model catalog in
// the initialize response, without contacting any provider.
const FAKE_CLI = `
const models = [
  {
    value: "default",
    resolvedModel: "claude-opus-5.5",
    displayName: "Default (recommended)",
    description: "",
    supportsEffort: true,
    supportedEffortLevels: ["high", "max"],
  },
  { value: "haiku", resolvedModel: "claude-haiku-4.5", displayName: "claude-haiku-4.5", description: "" },
];
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.type !== "control_request") continue;
    const response = message.request?.subtype === "initialize"
      ? { commands: [], agents: [], output_style: "default", available_output_styles: [], models, account: {} }
      : {};
    process.stdout.write(JSON.stringify({
      type: "control_response",
      response: { subtype: "success", request_id: message.request_id, response },
    }) + "\\n");
  }
});
`;

describe("ClaudeSdkAdapter model catalog", () => {
  let dir: string | undefined;
  let adapter: ClaudeSdkAdapter | undefined;

  afterEach(async () => {
    await adapter?.disconnect();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("records the catalog the CLI reports at initialization", async () => {
    // Model menus read this catalog, so a new session must publish what its CLI
    // actually offers (including user alias overrides) before any prompt is sent.
    dir = await mkdtemp(join(tmpdir(), "takode-claude-catalog-"));
    const binary = join(dir, "fake-claude");
    await writeFile(binary, `#!${process.execPath}\n${FAKE_CLI}`);
    await chmod(binary, 0o755);

    adapter = new ClaudeSdkAdapter("catalog-session", { cwd: dir, claudeBinary: binary, env: {} });

    await expect(adapter.started).resolves.toBe(true);
    await vi.waitFor(() =>
      expect(getClaudeModelCatalog()).toEqual([
        {
          value: "claude-opus-5.5",
          label: "Opus 5.5 (default)",
          description: "",
          isDefault: true,
          supportedReasoningLevels: [{ effort: "high" }, { effort: "max" }],
        },
        { value: "claude-haiku-4.5", label: "Haiku 4.5", description: "", supportedReasoningLevels: [] },
      ]),
    );
  });
});
