/** Restrict encoded variants to canonical code assets emitted under Vite's assets directory. */
export function isFrontendCodeAsset(path: string): boolean {
  return (
    path.startsWith("assets/") &&
    /\.(?:js|css)$/.test(path) &&
    !path.includes("\\") &&
    !path.split("/").some((part) => !part || part === "." || part === "..")
  );
}
