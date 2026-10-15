// @vitest-environment jsdom
// Pure helpers behind ToolBlock: icons, labels, previews, durations and board parsing.
import {
  getToolIcon,
  getToolLabel,
  getPreview,
  formatDuration,
  extractFirstJsonObject,
  parseBoardFromResult,
} from "./ToolBlock.js";

// ─── getToolIcon ─────────────────────────────────────────────────────────────

describe("getToolIcon", () => {
  it("returns 'terminal' for Bash", () => {
    expect(getToolIcon("Bash")).toBe("terminal");
  });

  it("returns 'file' for Read", () => {
    expect(getToolIcon("Read")).toBe("file");
  });

  it("returns 'file-plus' for Write", () => {
    expect(getToolIcon("Write")).toBe("file-plus");
  });

  it("returns 'file-edit' for Edit", () => {
    expect(getToolIcon("Edit")).toBe("file-edit");
  });

  it("returns 'search' for Glob", () => {
    expect(getToolIcon("Glob")).toBe("search");
  });

  it("returns 'search' for Grep", () => {
    expect(getToolIcon("Grep")).toBe("search");
  });

  it("returns 'globe' for WebFetch", () => {
    expect(getToolIcon("WebFetch")).toBe("globe");
  });

  it("returns 'globe' for WebSearch", () => {
    expect(getToolIcon("WebSearch")).toBe("globe");
  });

  it("returns 'list' for TaskCreate", () => {
    expect(getToolIcon("TaskCreate")).toBe("list");
  });

  it("returns 'message' for SendMessage", () => {
    expect(getToolIcon("SendMessage")).toBe("message");
  });

  it("returns 'tool' for unknown tool names", () => {
    expect(getToolIcon("SomeUnknownTool")).toBe("tool");
    expect(getToolIcon("")).toBe("tool");
    expect(getToolIcon("FooBar")).toBe("tool");
  });
});

// ─── getToolLabel ────────────────────────────────────────────────────────────

describe("getToolLabel", () => {
  it("returns 'Terminal' for Bash", () => {
    expect(getToolLabel("Bash")).toBe("Terminal");
  });

  it("returns 'Read File' for Read", () => {
    expect(getToolLabel("Read")).toBe("Read File");
  });

  it("returns 'Write File' for Write", () => {
    expect(getToolLabel("Write")).toBe("Write File");
  });

  it("returns 'Edit File' for Edit", () => {
    expect(getToolLabel("Edit")).toBe("Edit File");
  });

  it("returns 'Find Files' for Glob", () => {
    expect(getToolLabel("Glob")).toBe("Find Files");
  });

  it("returns 'Search Content' for Grep", () => {
    expect(getToolLabel("Grep")).toBe("Search Content");
  });

  it("returns known labels for newly added tools", () => {
    expect(getToolLabel("WebFetch")).toBe("Web Fetch");
    expect(getToolLabel("view_image")).toBe("View Image");
    expect(getToolLabel("Task")).toBe("Subagent");
    expect(getToolLabel("TodoWrite")).toBe("Tasks");
    expect(getToolLabel("NotebookEdit")).toBe("Notebook");
    expect(getToolLabel("SendMessage")).toBe("Message");
  });

  it("returns the name itself for unknown tools", () => {
    expect(getToolLabel("SomeUnknownTool")).toBe("SomeUnknownTool");
    expect(getToolLabel("CustomTool")).toBe("CustomTool");
  });
});

// ─── getPreview ──────────────────────────────────────────────────────────────

describe("getPreview", () => {
  it("extracts command for Bash tools", () => {
    expect(getPreview("Bash", { command: "ls -la" })).toBe("ls -la");
  });

  it("truncates Bash commands longer than 60 chars", () => {
    const longCommand = "a".repeat(80);
    const result = getPreview("Bash", { command: longCommand });
    expect(result).toBe("a".repeat(60) + "...");
    expect(result.length).toBe(63);
  });

  it("does not truncate Bash commands at exactly 60 chars", () => {
    const exactCommand = "b".repeat(60);
    expect(getPreview("Bash", { command: exactCommand })).toBe(exactCommand);
  });

  it("returns full path for Read (CSS handles visual truncation)", () => {
    expect(getPreview("Read", { file_path: "/home/user/project/src/index.ts" })).toBe(
      "/home/user/project/src/index.ts",
    );
  });

  it("returns full path for Write (CSS handles visual truncation)", () => {
    expect(getPreview("Write", { file_path: "/var/log/app.log" })).toBe("/var/log/app.log");
  });

  it("returns full path for Edit (CSS handles visual truncation)", () => {
    expect(getPreview("Edit", { file_path: "/a/b/c/d.txt" })).toBe("/a/b/c/d.txt");
  });

  it("handles short paths for file tools", () => {
    expect(getPreview("Read", { file_path: "file.txt" })).toBe("file.txt");
  });

  it("extracts pattern for Glob", () => {
    expect(getPreview("Glob", { pattern: "**/*.ts" })).toBe("**/*.ts");
  });

  it("extracts pattern for Grep", () => {
    expect(getPreview("Grep", { pattern: "TODO|FIXME" })).toBe("TODO|FIXME");
  });

  it("extracts query for WebSearch", () => {
    expect(getPreview("WebSearch", { query: "react testing library" })).toBe("react testing library");
  });

  it("returns the image path for view_image", () => {
    expect(getPreview("view_image", { path: "/tmp/proof.png" })).toBe("/tmp/proof.png");
  });

  it("shows the first pending TodoWrite item before anything is completed", () => {
    expect(
      getPreview("TodoWrite", {
        todos: [
          { content: "Inspect worktree", status: "pending" },
          { content: "Run tests", status: "pending" },
        ],
      }),
    ).toBe("Inspect worktree (2 left)");
  });

  it("extracts query for Codex web_search input shape", () => {
    expect(
      getPreview("web_search", {
        search_query: [{ q: "github openai codex skills config.toml skills directories" }],
      }),
    ).toBe("github openai codex skills config.toml skills directories");
  });

  it("returns empty string for unknown tools", () => {
    expect(getPreview("UnknownTool", { some: "data" })).toBe("");
  });

  it("returns empty string for Bash without command", () => {
    expect(getPreview("Bash", { description: "something" })).toBe("");
  });

  it("returns empty string for Read without file_path", () => {
    expect(getPreview("Read", { content: "data" })).toBe("");
  });
});

// ─── formatDuration ─────────────────────────────────────────────────────────

describe("formatDuration", () => {
  it("returns '<0.1s' for sub-100ms durations", () => {
    expect(formatDuration(0.0)).toBe("<0.1s");
    expect(formatDuration(0.05)).toBe("<0.1s");
  });

  it("formats durations under 10s with one decimal", () => {
    expect(formatDuration(0.1)).toBe("0.1s");
    expect(formatDuration(0.3)).toBe("0.3s");
    expect(formatDuration(2.5)).toBe("2.5s");
    expect(formatDuration(9.9)).toBe("9.9s");
  });

  it("formats durations 10-59s as whole seconds", () => {
    expect(formatDuration(10)).toBe("10s");
    expect(formatDuration(45.3)).toBe("45s");
    expect(formatDuration(59)).toBe("59s");
  });

  it("formats durations >= 60s as minutes and seconds", () => {
    expect(formatDuration(60)).toBe("1m0s");
    expect(formatDuration(125)).toBe("2m5s");
    expect(formatDuration(3661)).toBe("61m1s");
  });
});

// ─── extractFirstJsonObject ──────────────────────────────────────────────────
// Brace-counting JSON extractor used by board detection. Must handle JSON
// produced by JSON.stringify (with possible trailing text from the CLI).

describe("extractFirstJsonObject", () => {
  it("returns null for empty or non-JSON input", () => {
    expect(extractFirstJsonObject("")).toBeNull();
    expect(extractFirstJsonObject("no braces here")).toBeNull();
  });

  it("extracts a simple JSON object", () => {
    expect(extractFirstJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it("extracts JSON with nested objects", () => {
    const json = '{"outer":{"inner":{"deep":true}}}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });

  it("extracts JSON followed by trailing text (the board use case)", () => {
    const json = '{"__takode_board__":true,"board":[]}';
    const mixed = json + "\n\nQuest    Worker  State\nq-42     #5      DISPATCHED\n";
    expect(extractFirstJsonObject(mixed)).toBe(json);
  });

  it("handles braces inside string values", () => {
    const json = '{"text":"has { and } inside"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });

  it("handles escaped quotes inside strings", () => {
    const json = '{"key":"value with \\"escaped\\" quotes"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });

  it("handles escaped backslashes (\\\\) before closing quote", () => {
    // JSON: {"path":"C:\\Users"} -- the \\\\ is an escaped backslash, not an escape of the quote
    const json = '{"path":"C:\\\\Users"}';
    expect(extractFirstJsonObject(json)).toBe(json);
  });

  it("handles empty object", () => {
    expect(extractFirstJsonObject("{}")).toBe("{}");
  });

  it("skips text before the first opening brace", () => {
    expect(extractFirstJsonObject('text before {"a":1} text after')).toBe('{"a":1}');
  });

  it("returns null for unbalanced braces (missing closing)", () => {
    expect(extractFirstJsonObject('{"a":1')).toBeNull();
  });

  it("extracts a pretty-printed JSON object with trailing table", () => {
    // Simulates actual board CLI output: pretty JSON followed by text table
    const board = [{ questId: "q-1", title: "Fix bug", updatedAt: 1234 }];
    const json = JSON.stringify({ __takode_board__: true, board }, null, 2);
    const fullOutput = json + "\n\nQuest   Title    Worker  State\nq-1     Fix bug  --      PLANNED\n";
    const extracted = extractFirstJsonObject(fullOutput);
    expect(JSON.parse(extracted!)).toEqual({ __takode_board__: true, board });
  });
});

// ─── parseBoardFromResult ────────────────────────────────────────────────────
// Parses __takode_board__ marker JSON from CLI output, handling mixed
// JSON+text output and truncated previews.

describe("parseBoardFromResult", () => {
  it("returns null for undefined/empty input", () => {
    expect(parseBoardFromResult(undefined)).toBeNull();
    expect(parseBoardFromResult("")).toBeNull();
  });

  it("parses clean board JSON (--json mode)", () => {
    const board = [{ questId: "q-42", title: "Test", updatedAt: 100 }];
    const json = JSON.stringify({ __takode_board__: true, board });
    expect(parseBoardFromResult(json)).toEqual({ board, operation: undefined });
  });

  it("parses board JSON followed by text table (non --json mode)", () => {
    const board = [
      { questId: "q-42", title: "Test", worker: "abc", workerNum: 5, status: "DISPATCHED", updatedAt: 100 },
    ];
    const json = JSON.stringify({ __takode_board__: true, board }, null, 2);
    const mixed = json + "\n\nQuest   Title  Worker  State\nq-42    Test   #5      DISPATCHED\n";
    expect(parseBoardFromResult(mixed)).toEqual({ board, operation: undefined });
  });

  it("returns null if __takode_board__ marker is missing", () => {
    expect(parseBoardFromResult('{"other":true}')).toBeNull();
  });

  it("returns null if board is not an array", () => {
    expect(parseBoardFromResult('{"__takode_board__":true,"board":"not-array"}')).toBeNull();
  });

  it("returns null for plain text (no JSON at all)", () => {
    expect(parseBoardFromResult("Quest   Title  Worker  State\nq-42    Test   #5")).toBeNull();
  });

  it("handles empty board array", () => {
    const json = JSON.stringify({ __takode_board__: true, board: [] });
    expect(parseBoardFromResult(json)).toEqual({ board: [], operation: undefined });
  });

  it("extracts operation string when present", () => {
    const board = [{ questId: "q-42", title: "Test", updatedAt: 100 }];
    const json = JSON.stringify({ __takode_board__: true, board, operation: "advanced q-42 to PORTING" });
    const result = parseBoardFromResult(json);
    expect(result).toEqual({ board, operation: "advanced q-42 to PORTING" });
  });

  it("extracts queue warnings when present", () => {
    const board = [{ questId: "q-42", title: "Test", updatedAt: 100 }];
    const queueWarnings = [
      {
        questId: "q-42",
        kind: "dispatchable",
        summary: "q-42 can be dispatched now: wait-for resolved (q-9).",
      },
    ];
    const json = JSON.stringify({ __takode_board__: true, board, queueWarnings });
    const result = parseBoardFromResult(json);
    expect(result).toEqual({ board, operation: undefined, queueWarnings });
  });

  it("extracts proposal review payloads when present", () => {
    const board = [{ questId: "q-942", title: "Draft workflow", updatedAt: 100 }];
    const proposalReview = {
      questId: "q-942",
      title: "Draft workflow",
      status: "PROPOSED",
      presentedAt: 123,
      journey: {
        mode: "proposed",
        phaseIds: ["alignment", "implement"],
      },
    };
    const json = JSON.stringify({ __takode_board__: true, board, proposalReview });

    expect(parseBoardFromResult(json)).toEqual({
      board,
      operation: undefined,
      proposalReview,
    });
  });

  it("extracts row session statuses when present", () => {
    const board = [{ questId: "q-42", title: "Test", updatedAt: 100 }];
    const rowSessionStatuses = {
      "q-42": {
        worker: { sessionId: "worker-1", sessionNum: 11, status: "running" },
        reviewer: { sessionId: "reviewer-1", sessionNum: 12, status: "idle" },
      },
    };
    const json = JSON.stringify({ __takode_board__: true, board, rowSessionStatuses });

    expect(parseBoardFromResult(json)).toEqual({
      board,
      rowSessionStatuses,
      operation: undefined,
    });
  });
});
