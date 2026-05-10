const LEADER_PROFILE_PORTRAIT_ASSET_RE = /(?:^|\/)leader-profile-portraits\/.+\.v\d+\.[^/]+\.(?:webp|png|jpe?g)$/i;

export function getStaticAssetCacheControl(filePath: string): string | null {
  const normalizedPath = filePath.replaceAll("\\", "/");
  if (LEADER_PROFILE_PORTRAIT_ASSET_RE.test(normalizedPath)) {
    return "public, max-age=31536000, immutable";
  }
  return null;
}
