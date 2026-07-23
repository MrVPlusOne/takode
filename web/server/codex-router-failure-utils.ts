export type RouterFailureToolName = "write_stdin";

export function isToolRouterFailureMessage(message: string): boolean {
  return [
    /\bapply_patch verification failed\b/i,
    /\b(?:exec_command|write_stdin|view_image|spawn_agent|send_input|resume_agent|wait_agent|close_agent)\s+failed\b/i,
    /\btool(?:\s+call)?\s+failed\b/i,
  ].some((pattern) => pattern.test(message));
}

export function getRouterFailureToolName(message: string): RouterFailureToolName | null {
  if (/\bwrite_stdin\s+failed\b/i.test(message)) return "write_stdin";
  return null;
}
