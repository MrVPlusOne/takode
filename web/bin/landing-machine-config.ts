/**
 * Per-machine environment for landing-gate commands. A machine's defaults can
 * be wrong for gating, for example a package registry mirror that lags public
 * releases, so `takode land test` and landing runs on that machine apply the
 * variables in `~/.companion/landing.json` to every gate command (dependency
 * install and steps):
 *
 *   { "env": { "NPM_CONFIG_REGISTRY": "https://registry.npmjs.org/" } }
 *
 * Nothing is configured by default; the machine's own environment applies.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export function landingMachineConfigPath(home = homedir()): string {
  return join(home, ".companion", "landing.json");
}

/** The configured variables, or none when the file does not exist. Malformed files fail loudly. */
export async function loadLandingMachineEnv(path = landingMachineConfigPath()): Promise<Record<string, string>> {
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${path} is not valid JSON.`);
  }
  const env = (raw as { env?: unknown } | null)?.env ?? {};
  if (!env || typeof env !== "object" || Array.isArray(env))
    throw new Error(`${path}: "env" must be an object of environment variables.`);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`${path}: "${key}" is not a valid variable name.`);
    if (typeof value !== "string") throw new Error(`${path}: the value of ${key} must be a string.`);
    result[key] = value;
  }
  return result;
}

/** The environment gate commands run with: this process's, overridden by the machine's landing variables. */
export async function landingGateEnv(
  log: (line: string) => void,
  path = landingMachineConfigPath(),
): Promise<NodeJS.ProcessEnv> {
  const overrides = await loadLandingMachineEnv(path);
  const keys = Object.keys(overrides);
  // Values may be credentials, so only the names are logged.
  if (keys.length) log(`Gate commands use ${keys.join(", ")} from ${path}.`);
  return { ...process.env, ...overrides };
}
