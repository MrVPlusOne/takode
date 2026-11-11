interface UnderlineAstNode {
  type: string;
  value?: string;
  children?: UnderlineAstNode[];
  data?: { hName?: string };
}

const OPEN = /^<u\s*>$/i;
const CLOSE = /^<\/u\s*>$/i;

/**
 * Markdown has no underline, so `<u>text</u>` marks it, the one HTML tag Takode renders: drafts use it
 * for bold-underlined titles in Slack write-ups (`**<u>TL;DR</u>**`). Other raw HTML still shows as typed,
 * and so does a `<u>` with no `</u>` after it in the same paragraph or span.
 */
export function remarkUnderline() {
  return (tree: UnderlineAstNode) => {
    underlineIn(tree);
  };
}

function underlineIn(node: UnderlineAstNode): void {
  const children = node.children;
  if (!children) return;
  for (const child of children) underlineIn(child);
  const opens: number[] = [];
  for (let index = 0; index < children.length; index++) {
    const value = children[index].type === "html" ? children[index].value : undefined;
    if (value && OPEN.test(value)) opens.push(index);
    if (!value || !CLOSE.test(value) || opens.length === 0) continue;
    const open = opens.pop()!;
    const underline = { type: "underline", children: children.slice(open + 1, index), data: { hName: "u" } };
    children.splice(open, index - open + 1, underline);
    index = open;
  }
}
