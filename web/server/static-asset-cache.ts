const LEADER_PROFILE_PORTRAIT_ASSET_RE = /(?:^|\/)leader-profile-portraits\/.+\.v\d+\.[^/]+\.(?:webp|png|jpe?g)$/i;
// Vite names build output in assets/ after a hash of its content, so a name never changes meaning.
const CONTENT_HASHED_BUILD_ASSET_RE = /(?:^|\/)assets\/[^/]+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;

export function getStaticAssetCacheControl(filePath: string): string | null {
  const normalizedPath = filePath.replaceAll("\\", "/");
  if (normalizedPath === "index.html" || normalizedPath.endsWith("/index.html")) {
    return "no-store";
  }
  if (LEADER_PROFILE_PORTRAIT_ASSET_RE.test(normalizedPath) || CONTENT_HASHED_BUILD_ASSET_RE.test(normalizedPath)) {
    return "public, max-age=31536000, immutable";
  }
  return null;
}
