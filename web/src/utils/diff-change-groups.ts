import { orderDiffFilesCodeFirst } from "../../shared/diff-file-groups.js";
import { getChangeContent, getChangeFilePath, getChangePatch } from "./tool-rendering.js";

export interface ChangePatchGroup {
  filePath: string;
  changes: Array<Record<string, unknown>>;
  unifiedDiff: string;
  newText: string;
}

export function buildChangePatchGroups(
  changes: Array<Record<string, unknown>>,
  fallbackFilePath = "",
): ChangePatchGroup[] {
  const groups: ChangePatchGroup[] = [];
  const groupIndexes = new Map<string, number>();

  for (const change of changes) {
    const filePath = getChangeFilePath(change) || fallbackFilePath;
    if (!filePath) continue;

    const existingIndex = groupIndexes.get(filePath);
    if (existingIndex !== undefined) {
      groups[existingIndex].changes.push(change);
      continue;
    }

    groupIndexes.set(filePath, groups.length);
    groups.push({ filePath, changes: [change], unifiedDiff: "", newText: "" });
  }

  for (const group of groups) {
    group.unifiedDiff = group.changes
      .map((change) => getChangePatch(change))
      .filter(Boolean)
      .join("\n");
    group.newText = group.changes
      .map((change) => getChangeContent(change))
      .filter(Boolean)
      .join("\n");
  }

  return orderDiffFilesCodeFirst(groups, (group) => group.filePath);
}
