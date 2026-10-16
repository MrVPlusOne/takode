/**
 * Links in copied Takode content. Other apps can only use links that lead outside Takode: a link to this
 * app's own origin (session, quest, to-do or file-preview routes), a `file:` path or a placeholder only
 * points back at the copier's own server, so copies keep such links as their visible text.
 */

/** Return the absolute URL a copied link should keep, or null when the copy should keep only its text. */
export function portableLinkHref(href: string | null | undefined): string | null {
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return null;
  }
  const isOutsideLink =
    url.protocol === "mailto:" ||
    ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== window.location.origin);
  if (!isOutsideLink) return null;
  // Keep an absolute link exactly as written; only resolve relative ones.
  return /^[a-z][a-z\d+.-]*:/i.test(href.trim()) ? href.trim() : url.href;
}

/** Rewrite clipboard HTML so outside links are absolute and every other link is replaced by its contents. */
export function toPortableHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const anchor of Array.from(template.content.querySelectorAll("a"))) {
    const href = portableLinkHref(anchor.getAttribute("href"));
    if (href) anchor.setAttribute("href", href);
    else anchor.replaceWith(...Array.from(anchor.childNodes));
  }
  return template.innerHTML;
}

/** Whether a selection range touches a link that the browser's own copy would carry out as a Takode URL. */
export function rangeTouchesNonPortableLink(range: Range): boolean {
  const edgeAnchors = [range.startContainer, range.endContainer].map((node) =>
    (node instanceof Element ? node : node.parentElement)?.closest("a"),
  );
  const anchors = [...edgeAnchors, ...Array.from(range.cloneContents().querySelectorAll("a"))];
  return anchors.some((anchor) => anchor && !portableLinkHref(anchor.getAttribute("href")));
}
