export function admitSectionWindowRequest(input: {
  direction: "older" | "newer";
  requestKey: string;
  pendingRequestKey: string | null;
  send: () => boolean;
  markPending: (direction: "older" | "newer", requestKey: string) => boolean;
}): boolean {
  if (input.pendingRequestKey === input.requestKey) return false;
  if (!input.send()) return false;
  return input.markPending(input.direction, input.requestKey);
}
