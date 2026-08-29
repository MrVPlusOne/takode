import { toolRelationKey } from "../../shared/tool-relation-key.js";
import type { BrowserIncomingMessage, ToolResultPreview } from "../session-types.js";

/**
 * Add known results for tools visible in a bounded raw-history window.
 * Tool ids are owner-local, so root and native-child results must be matched
 * and emitted with their original ownership metadata.
 */
export function appendResolvedToolResultPreviewsForWindow(
  windowMessages: BrowserIncomingMessage[],
  fullHistory: BrowserIncomingMessage[],
): BrowserIncomingMessage[] {
  const visibleRelations: string[] = [];
  const seenRelations = new Set<string>();
  const resolvedInWindow = new Set<string>();

  for (const message of windowMessages) {
    if (message.type === "assistant") {
      const content = message.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block.type !== "tool_use" || !block.id) continue;
        const key = toolRelationKey(message, block.id);
        if (seenRelations.has(key)) continue;
        seenRelations.add(key);
        visibleRelations.push(key);
      }
      continue;
    }
    if (message.type === "tool_result_preview") {
      for (const preview of message.previews || []) {
        if (typeof preview.tool_use_id === "string") {
          resolvedInWindow.add(toolRelationKey(message, preview.tool_use_id));
        }
      }
    }
  }

  if (visibleRelations.length === 0) return windowMessages;

  const latestPreviewByRelation = new Map<
    string,
    { preview: ToolResultPreview; codexSubagent?: BrowserIncomingMessage["codexSubagent"] }
  >();
  for (const message of fullHistory) {
    if (message.type !== "tool_result_preview") continue;
    for (const preview of message.previews || []) {
      const key = toolRelationKey(message, preview.tool_use_id);
      if (seenRelations.has(key) && !resolvedInWindow.has(key)) {
        latestPreviewByRelation.set(key, {
          preview,
          ...(message.codexSubagent ? { codexSubagent: message.codexSubagent } : {}),
        });
      }
    }
  }

  const supplementalGroups: Array<{
    ownerKey: string;
    previews: ToolResultPreview[];
    codexSubagent?: BrowserIncomingMessage["codexSubagent"];
  }> = [];
  for (const relation of visibleRelations) {
    if (resolvedInWindow.has(relation)) continue;
    const match = latestPreviewByRelation.get(relation);
    if (!match) continue;
    const ownerKey = JSON.stringify([
      match.codexSubagent?.childId ?? null,
      match.codexSubagent?.parentChildId ?? null,
      match.codexSubagent?.rootTurnId ?? null,
    ]);
    const previous = supplementalGroups.at(-1);
    if (previous?.ownerKey === ownerKey) {
      previous.previews.push(match.preview);
      continue;
    }
    supplementalGroups.push({
      ownerKey,
      previews: [match.preview],
      ...(match.codexSubagent ? { codexSubagent: match.codexSubagent } : {}),
    });
  }
  if (supplementalGroups.length === 0) return windowMessages;

  return [
    ...windowMessages,
    ...supplementalGroups.map((group) => ({
      type: "tool_result_preview" as const,
      previews: group.previews,
      ...(group.codexSubagent ? { codexSubagent: group.codexSubagent } : {}),
    })),
  ];
}
