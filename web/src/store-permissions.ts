/** Count permissions that still require direct user attention. */
export function countUserPermissions(perms: Map<string, unknown> | undefined): number {
  if (!perms) return 0;
  let count = 0;
  for (const permission of perms.values()) {
    const state = permission as { evaluating?: string; autoApproved?: string };
    if (!state?.evaluating && !state?.autoApproved) count += 1;
  }
  return count;
}
