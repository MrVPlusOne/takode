export interface ActiveAutocompleteRange {
  replaceStart: number;
  tokenStart: number;
  replaceEnd: number;
}

export function findAutocompleteTokenEnd(inputText: string, tokenStart: number): number {
  let end = tokenStart;
  while (end < inputText.length && !/\s/.test(inputText[end]!)) {
    end += 1;
  }
  return end;
}

export function isCaretInsideAutocompleteRange(
  selectionStart: number,
  selectionEnd: number,
  range: ActiveAutocompleteRange | null,
): range is ActiveAutocompleteRange {
  return (
    range != null &&
    selectionStart === selectionEnd &&
    selectionStart > range.tokenStart &&
    selectionStart <= range.replaceEnd
  );
}

export function replaceAutocompleteRange(
  inputText: string,
  range: ActiveAutocompleteRange,
  insertText: string,
): { nextText: string; cursorPos: number } {
  const before = inputText.slice(0, range.replaceStart);
  const after = inputText.slice(range.replaceEnd);
  const hasFollowingWhitespace = after.length > 0 && /^\s/.test(after);
  const inserted = hasFollowingWhitespace ? insertText : `${insertText} `;
  const cursorPos = before.length + inserted.length + (hasFollowingWhitespace ? 1 : 0);
  return {
    nextText: before + inserted + after,
    cursorPos,
  };
}
