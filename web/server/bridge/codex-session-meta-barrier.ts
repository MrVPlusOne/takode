/** Preserve synchronous session_meta delivery unless a real cutover barrier needs async verification. */
export function runCodexSessionMetaBarrier(
  resolveBarrier: () => boolean | Promise<boolean>,
  onAllowed: () => void,
): void {
  let barrier: boolean | Promise<boolean>;
  try {
    barrier = resolveBarrier();
  } catch (error) {
    console.error("[ws-bridge] Codex session_meta barrier failed:", error);
    return;
  }
  if (typeof barrier === "boolean") {
    if (barrier) onAllowed();
    return;
  }
  void barrier
    .then((allowed) => {
      if (allowed) onAllowed();
    })
    .catch((error) => console.error("[ws-bridge] Codex session_meta barrier failed:", error));
}
