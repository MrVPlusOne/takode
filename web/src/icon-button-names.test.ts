/**
 * Guard: every icon-only button can say what it does.
 *
 * Takode draws a tooltip for whatever the mouse rests on from its `title`, or, for a control with
 * no text of its own, its `aria-label` (`components/AppTooltips.tsx`; Jiayi, Nov 2: every button
 * should explain itself on hover). An icon button with neither has no tooltip and no accessible
 * name, so this scans app source for `<button>` and `role="button"` elements whose content is only
 * markup (an icon: no text and no `{...}` expressions) and that carry no `title`, `aria-label` or
 * `aria-labelledby`. Buttons hidden from assistive technology (`aria-hidden`) and ones taking
 * spread props (their name comes from the caller) are skipped. Buttons whose content is computed
 * (`{icon}`) can't be judged statically and rely on review.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const SRC_DIR = __dirname;
const NAMES = new Set(["title", "aria-label", "aria-labelledby", "aria-hidden"]);

/** Tests and their helpers, fixtures and harnesses, and the Playground's mocks. */
function isTestCode(name: string): boolean {
  return name === "__tests__" || /\.test[.-]|^test-|-test-|^playground$|^Playground/i.test(name);
}

function collectComponents(dir: string, result: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!isTestCode(entry.name)) collectComponents(full, result);
    } else if (entry.name.endsWith(".tsx") && !isTestCode(entry.name)) {
      result.push(full);
    }
  }
  return result;
}

/** `file:line` of each icon-only button in `source` with no name. */
function unnamedIconButtons(source: string, file = "x.tsx"): string[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const attributes = (element: ts.JsxOpeningLikeElement) => element.attributes.properties;
  const isButton = (element: ts.JsxOpeningLikeElement) =>
    element.tagName.getText() === "button" ||
    attributes(element).some(
      (attribute) =>
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText() === "role" &&
        attribute.initializer?.getText() === '"button"',
    );
  const named = (element: ts.JsxOpeningLikeElement) =>
    attributes(element).some(
      (attribute) =>
        ts.isJsxSpreadAttribute(attribute) || (ts.isJsxAttribute(attribute) && NAMES.has(attribute.name.getText())),
    );
  const onlyMarkup = (element: ts.JsxElement) => {
    let markup = true;
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node)) markup &&= !node.getText().trim();
      else if (ts.isJsxExpression(node)) markup &&= !node.expression;
      else ts.forEachChild(node, visit);
    };
    element.children.forEach(visit);
    return markup;
  };
  const visit = (node: ts.Node) => {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    if (opening && isButton(opening) && !named(opening) && (!ts.isJsxElement(node) || onlyMarkup(node))) {
      found.push(`${file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

describe("icon buttons", () => {
  it("each have a title or an aria-label, which their tooltip shows", () => {
    const violations = collectComponents(SRC_DIR).flatMap((file) =>
      unnamedIconButtons(readFileSync(file, "utf8"), relative(SRC_DIR, file)),
    );
    expect(violations, "Give these icon buttons a title (or an aria-label): it is their tooltip").toEqual([]);
  });

  it("detects the unnamed icon buttons it guards against, and only those", () => {
    // Keeps the scan honest: a check that silently stopped matching would pass the test above.
    const flagged = unnamedIconButtons(`
      const a = <button onClick={close}><svg /></button>;
      const b = <div role="button" onClick={fold}><CloseIcon /></div>;
      const c = <button title="Close"><svg /></button>;
      const d = <button aria-label="Close"><svg /></button>;
      const e = <button>Close</button>;
      const f = <button>{label}</button>;
      const g = <button {...props}><svg /></button>;
      const h = <button aria-hidden />;
    `);
    expect(flagged).toEqual(["x.tsx:2", "x.tsx:3"]);
  });
});
