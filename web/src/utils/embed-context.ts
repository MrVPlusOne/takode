export function isEmbeddedInVsCode(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("takodeHost") === "vscode";
  } catch {
    return false;
  }
}
