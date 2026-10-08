import { networkInterfaces } from "node:os";

/**
 * Cheap offline check: a dropped Wi-Fi link leaves no external interface with a
 * routable address. Link-local addresses remain on idle interfaces, so they
 * do not count. A machine can pass this and still be unable to reach a given
 * service; callers treat it as "worth trying again", not as proof of access.
 */
export function hasUsableNetwork(): boolean {
  return Object.values(networkInterfaces()).some((addresses) =>
    (addresses ?? []).some(
      (address) => !address.internal && !address.address.startsWith("169.254.") && !/^fe80:/i.test(address.address),
    ),
  );
}
