/**
 * The text selected in or across `element`, or "" when the selection is empty or lies elsewhere. A
 * right-click menu offers Copy with it, so opening the menu doesn't take that away.
 */
export function selectedTextWithin(element: Element | null): string {
  const selection = element?.ownerDocument.defaultView?.getSelection();
  if (!element || !selection || selection.isCollapsed || selection.rangeCount === 0) return "";
  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer) && !range.intersectsNode(element)) return "";
  return selection.toString().trim();
}
