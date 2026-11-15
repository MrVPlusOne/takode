import { forwardRef, useCallback, useState, type Ref, type TextareaHTMLAttributes } from "react";
import { MarkdownReferenceLinks } from "./MarkdownReferenceLinks.js";
import { RichTextBox } from "./RichTextBox.js";
import { useChatTextBoxMode } from "./chat-text-box-mode.js";
import type { RichTextBoxElement } from "./rich-text-box.js";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "wrap"> & {
  value: string;
  wrap?: "soft" | "off";
  /** Undo and redo of a draft that keeps its own history; see {@link RichTextBox}. */
  onUndo?: () => void;
  onRedo?: () => void;
};

/**
 * A chat input (message box, side chat, comment or answer): the Markdown box ({@link RichTextBox})
 * that draws basic Markdown and quest and session references as you type, or a plain textarea when
 * the Message Box setting says so. It takes a textarea's props and its ref answers the textarea
 * API, so a box written for a textarea works with either.
 */
export const ChatTextBox = forwardRef<HTMLTextAreaElement, Props>(function ChatTextBox(
  { onUndo, onRedo, onChange, rows, wrap, autoFocus, disabled, placeholder, ...rest },
  ref,
) {
  const mode = useChatTextBoxMode();
  const [box, setBox] = useState<HTMLElement | null>(null);
  // The box goes both to the caller's ref and to its links.
  const boxRef = useCallback(
    (element: RichTextBoxElement | null) => {
      setBox(element);
      if (typeof ref === "function") ref(element as unknown as HTMLTextAreaElement);
      else if (ref) ref.current = element as unknown as HTMLTextAreaElement;
    },
    [ref],
  );
  if (mode === "plain") {
    return (
      <textarea
        ref={ref}
        data-chat-input
        onChange={onChange}
        rows={rows}
        wrap={wrap}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        {...rest}
      />
    );
  }
  // The rich box's element answers the textarea API, so the textarea's handlers take its events as
  // they are.
  const richProps = { ...rest, onInput: onChange } as unknown as Omit<
    React.ComponentProps<typeof RichTextBox>,
    "value" | "placeholder"
  >;
  return (
    <>
      <RichTextBox
        {...richProps}
        ref={boxRef as Ref<RichTextBoxElement>}
        value={rest.value}
        data-chat-input
        onUndo={onUndo}
        onRedo={onRedo}
        rows={rows}
        wrap={wrap}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder ?? ""}
      />
      <MarkdownReferenceLinks box={box} />
    </>
  );
});
