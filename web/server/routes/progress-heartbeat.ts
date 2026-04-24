import type { CreationStepId } from "../session-types.js";

export type ProgressHeartbeatEmitter =
  | ((step: CreationStepId, label: string, status: "in_progress" | "done" | "error", detail?: string) => Promise<void>)
  | undefined;

export async function withProgressHeartbeat<T>(
  emit: ProgressHeartbeatEmitter,
  config: { step: CreationStepId; label: string; detail: string },
  run: () => Promise<T>,
): Promise<T> {
  if (!emit) return run();

  let stopped = false;
  let stopWaiting = () => {};
  const stopSignal = new Promise<void>((resolve) => {
    stopWaiting = resolve;
  });

  const heartbeatLoop = (async () => {
    while (!stopped) {
      await Promise.race([new Promise<void>((resolve) => setTimeout(resolve, 5_000)), stopSignal]);
      if (stopped) break;
      await emit(config.step, config.label, "in_progress", config.detail);
    }
  })();

  try {
    return await run();
  } finally {
    stopped = true;
    stopWaiting();
    await heartbeatLoop;
  }
}
