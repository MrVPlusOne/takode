export interface ParsedEditToolInput {
  filePath: string;
  oldText: string;
  newText: string;
  changes: Array<Record<string, unknown>>;
  unifiedDiff: string;
}

export interface ParseEditToolInputOptions {
  fallbackToFirstChangePath?: boolean;
}

export function getChangePatch(change: Record<string, unknown>): string {
  const candidates = [
    change.diff,
    change.unified_diff,
    change.unifiedDiff,
    change.patch,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

export function parseEditToolInput(
  input: Record<string, unknown>,
  options: ParseEditToolInputOptions = {},
): ParsedEditToolInput {
  const changes = Array.isArray(input.changes)
    ? (input.changes as Array<Record<string, unknown>>)
    : [];
  const firstChangePath = changes.find((c) => typeof c.path === "string")?.path as string | undefined;
  const filePath = options.fallbackToFirstChangePath
    ? String(input.file_path || firstChangePath || "")
    : String(input.file_path || "");
  const oldText = String(input.old_string || "");
  const newText = String(input.new_string || "");
  const unifiedDiff = changes.map((change) => getChangePatch(change)).filter(Boolean).join("\n");

  return {
    filePath,
    oldText,
    newText,
    changes,
    unifiedDiff,
  };
}

export function parseWriteToolInput(input: Record<string, unknown>): {
  filePath: string;
  content: string;
} {
  return {
    filePath: String(input.file_path || ""),
    content: String(input.content || ""),
  };
}
