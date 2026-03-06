"use strict";

function summarizeText(text, maxLength = 120) {
  const collapsed = String(text || "").replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return "";
  }
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  if (maxLength <= 3) {
    return collapsed.slice(0, maxLength);
  }
  return `${collapsed.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatSelectionContext(input) {
  if (!input || !input.pathLabel) {
    return "No active editor";
  }

  const start = `${input.startLine}:${input.startCharacter}`;
  if (input.isEmpty) {
    const preview = summarizeText(input.lineText, 90);
    return preview
      ? `Cursor: ${input.pathLabel}:${start}  ${preview}`
      : `Cursor: ${input.pathLabel}:${start}`;
  }

  const end = `${input.endLine}:${input.endCharacter}`;
  const preview = summarizeText(input.selectedText, 90);
  return preview
    ? `Selection: ${input.pathLabel}:${start}-${end}  ${preview}`
    : `Selection: ${input.pathLabel}:${start}-${end}`;
}

function formatSelectionLocation(input) {
  if (!input || !input.pathLabel) {
    return "";
  }
  const start = `${input.startLine}:${input.startCharacter}`;
  if (input.isEmpty) {
    return `${input.pathLabel}:${start}`;
  }
  const end = `${input.endLine}:${input.endCharacter}`;
  return `${input.pathLabel}:${start}-${end}`;
}

function buildSelectionPayload(input) {
  if (!input || !input.pathLabel) {
    return null;
  }
  const location = formatSelectionLocation(input);
  if (!location) {
    return null;
  }
  return {
    label: formatSelectionContext(input),
    messageSuffix: `[user cursor in VSCode: ${location}] (this may or may not be relevant)`,
  };
}

module.exports = {
  buildSelectionPayload,
  formatSelectionContext,
  formatSelectionLocation,
  summarizeText,
};
