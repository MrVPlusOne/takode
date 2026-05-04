// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import { ToolBlock } from "./ToolBlock.js";

vi.mock("../api.js", () => ({
  api: {
    getSettings: vi.fn(),
    getToolResult: vi.fn(),
    getFsImageUrl: vi.fn((path: string) => `/api/fs/image?path=${encodeURIComponent(path)}`),
    openVsCodeRemoteFile: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(api.getSettings).mockReset();
  vi.mocked(api.getToolResult).mockReset();
  vi.mocked(api.openVsCodeRemoteFile).mockReset();
  vi.mocked(api.getSettings).mockResolvedValue({ editorConfig: { editor: "vscode-local" } } as Awaited<
    ReturnType<typeof api.getSettings>
  >);
  useStore.setState({ toolResults: new Map(), latestBoardToolUseId: new Map() });
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("ToolBlock multi-file Edit rendering", () => {
  it("renders changes under each change path when file_path points at the first file", async () => {
    // Regression for q-997: one apply_patch/Edit tool can set top-level
    // file_path to the first file while carrying headerless hunks for multiple
    // change.path values. The UI must not render later hunks under that first
    // file's header or Open File target.
    window.history.replaceState({}, "", "/?takodeHost=vscode");
    const postMessageSpy = vi.spyOn(window.parent, "postMessage");
    const leaderDispatchPath = "/Users/jiayiwei/Code/companion/.claude/skills/leader-dispatch/SKILL.md";
    const questDesignPath = "/Users/jiayiwei/Code/companion/.claude/skills/quest-design/SKILL.md";

    const { container } = render(
      <ToolBlock
        name="Edit"
        input={{
          file_path: leaderDispatchPath,
          changes: [
            {
              path: leaderDispatchPath,
              kind: "update",
              diff: [
                "@@ -56,2 +56,4 @@",
                " ",
                "+When a proposal includes multiple non-standard phase notes, format them as bullets keyed by phase.",
                "+",
                " The scheduling/orchestration plan must state at least:",
              ].join("\n"),
            },
            {
              path: questDesignPath,
              kind: "update",
              diff: [
                "@@ -42,2 +42,4 @@",
                " ",
                "+When a proposal includes multiple non-standard phase notes, format them as bullets keyed by phase.",
                "+",
                " Clarification-needed case: ask the material questions using the quest framing below.",
              ].join("\n"),
            },
          ],
        }}
        toolUseId="tool-multi-file-path-repro"
        defaultOpen={false}
      />,
    );

    const header = screen.getByRole("button", { name: /Edit File.*2 files/ });
    expect(header.textContent).not.toContain("leader-dispatch");
    expect(screen.queryByRole("button", { name: "Open File" })).toBeNull();

    fireEvent.click(header);

    const diffFiles = Array.from(container.querySelectorAll(".diff-file"));
    expect(diffFiles).toHaveLength(2);
    expect(diffFiles[0].textContent).toContain("leader-dispatch");
    expect(diffFiles[0].textContent).toContain("@@ -56,2 +56,4 @@");
    expect(diffFiles[1].textContent).toContain("quest-design");
    expect(diffFiles[1].textContent).toContain("@@ -42,2 +42,4 @@");

    const openButtons = screen.getAllByRole("button", { name: "Open File" });
    expect(openButtons).toHaveLength(2);

    fireEvent.click(openButtons[0]);
    fireEvent.click(openButtons[1]);

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        {
          source: "takode-vscode-prototype",
          type: "takode:open-file",
          payload: { absolutePath: leaderDispatchPath, line: 56, column: 1 },
        },
        "*",
      );
      expect(postMessageSpy).toHaveBeenCalledWith(
        {
          source: "takode-vscode-prototype",
          type: "takode:open-file",
          payload: { absolutePath: questDesignPath, line: 42, column: 1 },
        },
        "*",
      );
    });
  });
});

describe("ToolBlock multi-file Write rendering", () => {
  it("renders per-file diffs when Codex sends raw file contents in change diff fields", async () => {
    // Codex can report newly written files as changes where `diff` is the
    // complete file content, not unified diff text. Those still need per-file
    // panels instead of empty diff viewers.
    window.history.replaceState({}, "", "/?takodeHost=vscode");
    const postMessageSpy = vi.spyOn(window.parent, "postMessage");
    const innerScriptPath = "/tmp/retry/full_datagen_inner.sh";
    const wrapperScriptPath = "/tmp/retry/launch_tmux_retry.sh";

    const { container } = render(
      <ToolBlock
        name="Write"
        input={{
          file_path: innerScriptPath,
          changes: [
            {
              path: innerScriptPath,
              kind: "add",
              diff: [
                "#!/usr/bin/env bash",
                "set -uo pipefail",
                "",
                "EXP_ROOT=/mnt/vast/data/example/run",
                'DATAGEN_LOG="$EXP_ROOT/logs/datagen.log"',
                "",
                "{",
                '  echo "__INNER_START__ $(date -u +%FT%TZ)"',
                '  exec python user_scripts/datagen/standalone/launch.py >> "$DATAGEN_LOG" 2>&1',
                "}",
              ].join("\n"),
            },
            {
              path: wrapperScriptPath,
              kind: "add",
              diff: [
                "#!/usr/bin/env bash",
                "set -euo pipefail",
                "",
                "SESSION=baseline_rollout",
                "INNER=/tmp/full_datagen_inner.sh",
                "",
                'chmod +x "$INNER"',
                'tmux new-session -d -s "$SESSION" "bash $INNER"',
              ].join("\n"),
            },
          ],
        }}
        toolUseId="tool-multi-file-write-raw-content"
        defaultOpen={false}
      />,
    );

    const header = screen.getByRole("button", { name: /Write File.*2 files/ });
    expect(header.textContent).not.toContain("full_datagen_inner");
    expect(screen.queryByRole("button", { name: "Open File" })).toBeNull();

    fireEvent.click(header);

    expect(screen.queryByText("No changes")).toBeNull();
    const diffFiles = Array.from(container.querySelectorAll(".diff-file"));
    expect(diffFiles).toHaveLength(2);
    expect(diffFiles[0].textContent).toContain("full_datagen_inner.sh");
    expect(diffFiles[0].textContent).toContain("set -uo pipefail");
    expect(diffFiles[1].textContent).toContain("launch_tmux_retry.sh");
    expect(diffFiles[1].textContent).toContain("tmux new-session");
    expect(container.querySelectorAll(".diff-line-add").length).toBeGreaterThan(2);

    const openButtons = screen.getAllByRole("button", { name: "Open File" });
    expect(openButtons).toHaveLength(2);

    fireEvent.click(openButtons[0]);
    fireEvent.click(openButtons[1]);

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        {
          source: "takode-vscode-prototype",
          type: "takode:open-file",
          payload: { absolutePath: innerScriptPath, line: 1, column: 1 },
        },
        "*",
      );
      expect(postMessageSpy).toHaveBeenCalledWith(
        {
          source: "takode-vscode-prototype",
          type: "takode:open-file",
          payload: { absolutePath: wrapperScriptPath, line: 1, column: 1 },
        },
        "*",
      );
    });
  });

  it("renders patch changes under each change path when content fallback would otherwise be non-empty", async () => {
    // Write parsing can derive synthetic content from patch text. Multi-file
    // patch payloads must be grouped before that fallback renders one combined
    // new-file diff with no per-file headers or Open File targets.
    window.history.replaceState({}, "", "/?takodeHost=vscode");
    const postMessageSpy = vi.spyOn(window.parent, "postMessage");
    const configPath = "/Users/jiayiwei/Code/companion/web/src/config.ts";
    const serverConfigPath = "/Users/jiayiwei/Code/companion/web/server/config.ts";

    const { container } = render(
      <ToolBlock
        name="Write"
        input={{
          file_path: configPath,
          changes: [
            {
              path: configPath,
              kind: "create",
              diff: [
                "diff --git a/web/src/config.ts b/web/src/config.ts",
                "--- /dev/null",
                "+++ b/web/src/config.ts",
                "@@ -0,0 +1,2 @@",
                "+export const uiMode = 'compact';",
                "+export const showDiffHeaders = true;",
              ].join("\n"),
            },
            {
              path: serverConfigPath,
              kind: "create",
              diff: [
                "diff --git a/web/server/config.ts b/web/server/config.ts",
                "--- /dev/null",
                "+++ b/web/server/config.ts",
                "@@ -0,0 +1,2 @@",
                "+export const apiMode = 'strict';",
                "+export const emitPatchGroups = true;",
              ].join("\n"),
            },
          ],
        }}
        toolUseId="tool-multi-file-write-path-repro"
        defaultOpen={false}
      />,
    );

    const header = screen.getByRole("button", { name: /Write File.*2 files/ });
    expect(header.textContent).not.toContain("config.ts");
    expect(screen.queryByRole("button", { name: "Open File" })).toBeNull();

    fireEvent.click(header);

    const diffFiles = Array.from(container.querySelectorAll(".diff-file"));
    expect(diffFiles).toHaveLength(2);
    expect(diffFiles[0].textContent).toContain("web/src/");
    expect(diffFiles[0].textContent).toContain("config.ts");
    expect(diffFiles[0].textContent).toContain("uiMode");
    expect(diffFiles[1].textContent).toContain("web/server/");
    expect(diffFiles[1].textContent).toContain("config.ts");
    expect(diffFiles[1].textContent).toContain("apiMode");

    const openButtons = screen.getAllByRole("button", { name: "Open File" });
    expect(openButtons).toHaveLength(2);

    fireEvent.click(openButtons[0]);
    fireEvent.click(openButtons[1]);

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        {
          source: "takode-vscode-prototype",
          type: "takode:open-file",
          payload: { absolutePath: configPath, line: 1, column: 1 },
        },
        "*",
      );
      expect(postMessageSpy).toHaveBeenCalledWith(
        {
          source: "takode-vscode-prototype",
          type: "takode:open-file",
          payload: { absolutePath: serverConfigPath, line: 1, column: 1 },
        },
        "*",
      );
    });
  });
});
