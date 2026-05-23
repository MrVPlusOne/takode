export function applyUserMessageDeliveryPrefix(content: string | unknown[], prefix: string): string | unknown[] {
  if (!prefix) return content;
  if (typeof content === "string") return prefix + content;
  const firstTextIndex = content.findIndex(
    (block): block is { type: "text"; text: string } =>
      !!block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string",
  );
  if (firstTextIndex < 0) return [{ type: "text", text: prefix.trimEnd() }, ...content];
  const next = content.slice();
  const firstText = next[firstTextIndex] as { type: "text"; text: string };
  next[firstTextIndex] = { ...firstText, text: prefix + firstText.text };
  return next;
}
