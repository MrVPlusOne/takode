/** Ask the known backend to stop, retaining its process and snapshot if pending state cannot be saved. */
export async function waitForBackendShutdown(
  backend: { kill(signal: "SIGTERM"): void; exited: Promise<number> },
  warn: (message: string) => void,
  warningAfterMs = 15_000,
): Promise<void> {
  backend.kill("SIGTERM");
  const warning = setTimeout(() => {
    warn("Backend shutdown is still pending; preserving state and waiting for actual exit. No replacement started.");
  }, warningAfterMs);
  try {
    await backend.exited;
  } finally {
    clearTimeout(warning);
  }
}
