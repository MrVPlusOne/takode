import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import { appendResolvedToolResultPreviewsForWindow } from "./history-window-tool-results.js";

function toolMessage(
  id: string,
  command: string,
  codexSubagent?: BrowserIncomingMessage["codexSubagent"],
): Extract<BrowserIncomingMessage, { type: "assistant" }> {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "gpt-5.5",
      content: [{ type: "tool_use", id: "shared-tool-id", name: "Bash", input: { command } }],
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    ...(codexSubagent ? { codexSubagent } : {}),
  };
}

function previewMessage(
  content: string,
  codexSubagent?: BrowserIncomingMessage["codexSubagent"],
): Extract<BrowserIncomingMessage, { type: "tool_result_preview" }> {
  return {
    type: "tool_result_preview",
    previews: [
      {
        tool_use_id: "shared-tool-id",
        content,
        is_error: false,
        total_size: content.length,
        is_truncated: false,
      },
    ],
    ...(codexSubagent ? { codexSubagent } : {}),
  };
}

describe("history-window tool result closure", () => {
  it("supplements same-id root and child tools with owner-matched previews", () => {
    // Provider tool ids are owner-local. Supplemental raw-history previews
    // retain child ownership so neither result can settle the other command.
    const childOwnership = { childId: "opaque-child", rootTurnId: "root-turn" };
    const rootTool = toolMessage("root-tool", "root");
    const childTool = toolMessage("child-tool", "child", childOwnership);
    const rootPreview = previewMessage("root result");
    const childPreview = previewMessage("child result", childOwnership);

    const messages = appendResolvedToolResultPreviewsForWindow(
      [rootTool, childTool],
      [rootTool, childTool, childPreview, rootPreview],
    );
    const supplements = messages.slice(2);

    expect(supplements).toHaveLength(2);
    expect(supplements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ previews: [expect.objectContaining({ content: "root result" })] }),
        expect.objectContaining({
          codexSubagent: childOwnership,
          previews: [expect.objectContaining({ content: "child result" })],
        }),
      ]),
    );
    expect(supplements.find((message) => message.codexSubagent == null)).toBeDefined();
  });

  it("keeps distinct public ownership shapes separate for one child", () => {
    // Restored audit rows may prove child identity before their root turn is
    // resolved. Supplemental records must not add or erase that distinction.
    const unresolvedOwnership = { childId: "opaque-child" };
    const resolvedOwnership = { childId: "opaque-child", rootTurnId: "root-turn" };
    const unresolvedTool = toolMessage("unresolved-tool", "unresolved", unresolvedOwnership);
    unresolvedTool.message.content[0] = {
      type: "tool_use",
      id: "unresolved-shared-id",
      name: "Bash",
      input: { command: "unresolved" },
    };
    const resolvedTool = toolMessage("resolved-tool", "resolved", resolvedOwnership);
    resolvedTool.message.content[0] = {
      type: "tool_use",
      id: "resolved-shared-id",
      name: "Bash",
      input: { command: "resolved" },
    };
    const unresolvedPreview = previewMessage("unresolved child result", unresolvedOwnership);
    unresolvedPreview.previews[0]!.tool_use_id = "unresolved-shared-id";
    const resolvedPreview = previewMessage("resolved child result", resolvedOwnership);
    resolvedPreview.previews[0]!.tool_use_id = "resolved-shared-id";

    const messages = appendResolvedToolResultPreviewsForWindow(
      [unresolvedTool, resolvedTool],
      [unresolvedTool, resolvedTool, resolvedPreview, unresolvedPreview],
    );
    const supplements = messages.slice(2);

    expect(supplements).toHaveLength(2);
    expect(supplements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codexSubagent: unresolvedOwnership,
          previews: [expect.objectContaining({ content: "unresolved child result" })],
        }),
        expect.objectContaining({
          codexSubagent: resolvedOwnership,
          previews: [expect.objectContaining({ content: "resolved child result" })],
        }),
      ]),
    );
  });

  it("preserves interleaved ownership order when distinct children reuse tool ids", () => {
    const childA = { childId: "child-a", rootTurnId: "root-turn" };
    const childB = { childId: "child-b", rootTurnId: "root-turn" };
    const firstA = toolMessage("first-a", "first a", childA);
    firstA.message.content[0] = { type: "tool_use", id: "tool-a-1", name: "Bash", input: {} };
    const onlyB = toolMessage("only-b", "only b", childB);
    onlyB.message.content[0] = { type: "tool_use", id: "tool-b", name: "Bash", input: {} };
    const secondA = toolMessage("second-a", "second a", childA);
    secondA.message.content[0] = { type: "tool_use", id: "tool-a-2", name: "Bash", input: {} };
    const resultFor = (toolUseId: string, content: string, ownership: typeof childA) => {
      const result = previewMessage(content, ownership);
      result.previews[0]!.tool_use_id = toolUseId;
      return result;
    };

    const supplements = appendResolvedToolResultPreviewsForWindow(
      [firstA, onlyB, secondA],
      [
        firstA,
        onlyB,
        secondA,
        resultFor("tool-a-1", "a one", childA),
        resultFor("tool-b", "b", childB),
        resultFor("tool-a-2", "a two", childA),
      ],
    ).slice(3);

    expect(supplements.map((message) => message.codexSubagent?.childId)).toEqual(["child-a", "child-b", "child-a"]);
    expect(
      supplements.map((message) =>
        message.type === "tool_result_preview" ? message.previews.map((preview) => preview.content) : [],
      ),
    ).toEqual([["a one"], ["b"], ["a two"]]);
  });

  it("does not append a child preview when the same-id root tool is already resolved", () => {
    const childOwnership = { childId: "opaque-child", rootTurnId: "root-turn" };
    const rootTool = toolMessage("root-tool", "root");
    const rootPreview = previewMessage("root result");
    const childPreview = previewMessage("child result", childOwnership);

    const messages = appendResolvedToolResultPreviewsForWindow(
      [rootTool, rootPreview],
      [rootTool, childPreview, rootPreview],
    );

    expect(messages).toEqual([rootTool, rootPreview]);
  });
});
