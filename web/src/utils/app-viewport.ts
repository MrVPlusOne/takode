export function resolveAppViewportHeight(): string {
  return "100dvh";
}

export function installAppViewportSizing(win: Window): () => void {
  const html = win.document.documentElement;
  const body = win.document.body;
  const root = win.document.getElementById("root");

  html.style.overflow = "hidden";
  html.style.height = resolveAppViewportHeight();
  html.style.width = "100vw";
  body.style.height = "100%";
  body.style.width = "100%";
  body.style.margin = "0";
  if (root) {
    root.style.height = "100%";
    root.style.width = "100%";
  }

  return () => {};
}
