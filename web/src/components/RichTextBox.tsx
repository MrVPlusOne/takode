import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type HTMLAttributes } from "react";
import { installTextBoxApi, plainLines, readText, reconcile, type RichTextBoxElement } from "./rich-text-box.js";
import { markdownLines } from "./rich-text-markdown.js";

type Props = Omit<HTMLAttributes<HTMLDivElement>, "onInput" | "placeholder"> & {
  value: string;
  /** Draws basic Markdown as you type; otherwise the box looks like a plain textarea. */
  markdown: boolean;
  placeholder: string;
  /** Called after the text changed, with the box's value and selection already current. */
  onInput: (event: React.FormEvent<RichTextBoxElement>) => void;
  /** The box keeps no undo history of its own (redrawing lines confuses the browser's): these do it. */
  onUndo: () => void;
  onRedo: () => void;
  /** "off" keeps every line on one row, as a textarea's `wrap="off"`. */
  wrap?: "soft" | "off";
};

/**
 * A text box on a `contenteditable` element that behaves like a textarea: its value is plain
 * text, paste and drop bring in plain text only (`plaintext-only`, so no colours or fonts from
 * elsewhere), and its element answers the textarea API the composer uses ({@link
 * installTextBoxApi}). Unlike a textarea, the browser can say where any character is drawn, and
 * lines can be styled: with `markdown` it draws basic Markdown as you type ({@link markdownLines}).
 *
 * Input methods (pinyin) are left alone while composing; lines are redrawn when the text is
 * committed. Enter and Shift+Enter add a plain line break (continuing a Markdown list), and undo
 * and redo go to `onUndo`/`onRedo`.
 */
export const RichTextBox = forwardRef<RichTextBoxElement, Props>(function RichTextBox(
  { value, markdown, placeholder, onInput, onUndo, onRedo, wrap = "soft", className = "", style, ...rest },
  ref,
) {
  const rootRef = useRef<RichTextBoxElement>(null);
  const render = markdown ? markdownLines : plainLines;
  const latest = useRef({ render, onUndo, onRedo });
  latest.current = { render, onUndo, onRedo };
  const composing = useRef(false);
  useImperativeHandle(ref, () => rootRef.current!, []);

  // Draws the box's own text again, keeping the selection, after the browser edited it.
  const redraw = () => {
    const root = rootRef.current!;
    const { selectionStart, selectionEnd } = root;
    if (reconcile(root, readText(root).text, latest.current.render) && root.ownerDocument.activeElement === root) {
      root.setSelectionRange(selectionStart, selectionEnd);
    }
  };
  const redrawRef = useRef(redraw);
  redrawRef.current = redraw;

  useLayoutEffect(() => {
    const root = rootRef.current!;
    const remove = installTextBoxApi(root, () => latest.current.render);
    const beforeInput = (event: InputEvent) => {
      if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
        event.preventDefault();
        if (event.inputType === "historyUndo") latest.current.onUndo();
        else latest.current.onRedo();
        return;
      }
      if (event.inputType !== "insertParagraph" && event.inputType !== "insertLineBreak") return;
      event.preventDefault();
      const { selectionStart: start, selectionEnd: end, value: text } = root;
      const lineStart = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
      const item = latest.current.render === markdownLines ? listItem(text.slice(lineStart, start)) : null;
      if (item?.empty && start === end && !/\S/.test(text.slice(end).split("\n")[0]!)) {
        // Enter on an empty list item ends the list, as in Slack and most editors.
        root.setRangeText(item.indent, lineStart, start, "end");
      } else {
        root.setRangeText(`\n${item?.next ?? ""}`, start, end, "end");
      }
      root.dispatchEvent(new Event("input", { bubbles: true }));
    };
    // The browser offers undo only while its own history has steps, which redrawn lines and
    // outside changes (voice, autocomplete) leave out, so the keys go to the draft's history.
    const keyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const redo = (key === "z" && event.shiftKey) || (key === "y" && event.ctrlKey && !event.shiftKey);
      if (key !== "z" && !redo) return;
      event.preventDefault();
      if (redo) latest.current.onRedo();
      else latest.current.onUndo();
    };
    const composition = (event: CompositionEvent) => {
      composing.current = event.type === "compositionstart";
      if (!composing.current) redrawRef.current();
    };
    root.addEventListener("beforeinput", beforeInput);
    root.addEventListener("keydown", keyDown);
    root.addEventListener("compositionstart", composition);
    root.addEventListener("compositionend", composition);
    return () => {
      root.removeEventListener("beforeinput", beforeInput);
      root.removeEventListener("keydown", keyDown);
      root.removeEventListener("compositionstart", composition);
      root.removeEventListener("compositionend", composition);
      remove();
    };
  }, []);

  // The draft changed from outside (voice, autocomplete, undo, another browser), or the drawing
  // style did: draw it. Text the box itself just reported is already drawn.
  const drawnWith = useRef<typeof render | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current!;
    if (readText(root).text !== value) root.value = value;
    else if (drawnWith.current !== render) {
      const { selectionStart, selectionEnd } = root;
      reconcile(root, value, render);
      root.setSelectionRange(selectionStart, selectionEnd);
    }
    drawnWith.current = render;
    root.toggleAttribute("data-empty", value === "");
  }, [value, render]);

  return (
    <div
      {...rest}
      ref={rootRef}
      role="textbox"
      aria-multiline="true"
      aria-placeholder={placeholder}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      data-rich-text-box={markdown ? "markdown" : "plain"}
      className={`rt-box ${wrap === "off" ? "whitespace-pre" : ""} ${className}`}
      style={{ ...style, "--rt-placeholder": JSON.stringify(placeholder) } as React.CSSProperties}
      onInput={(event) => {
        if (!composing.current && !(event.nativeEvent as InputEvent).isComposing) redraw();
        onInput(event as unknown as React.FormEvent<RichTextBoxElement>);
      }}
    />
  );
});

/** A Markdown list item's start: its indent, whether it is still empty, and the next item's start. */
function listItem(beforeCaret: string): { indent: string; empty: boolean; next: string } | null {
  const match = /^( *)([-*+]|(\d{1,9})([.)]))( +)(.*)$/.exec(beforeCaret);
  if (!match) return null;
  const [, indent, sign, number, delimiter, space, content] = match;
  const marker = number ? `${Number(number) + 1}${delimiter}` : sign!;
  return { indent: indent!, empty: !content, next: `${indent}${marker}${space}` };
}
