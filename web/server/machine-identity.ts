import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, hostname, userInfo } from "node:os";
import { dirname, join } from "node:path";

/**
 * A machine's name belongs to the machine, not to the Takode server it serves,
 * so it stays the same when the coordinator role moves to another machine.
 * Each machine keeps it in its own `~/.companion/machine.json`; the
 * coordinator creates its own from the hostname, and a host without one takes
 * the name it was registered with.
 */

/** Names shown for machines: letters, digits, '.', '_' or '-', starting with a letter or digit. */
const MACHINE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

/** A machine as sessions and quest notes describe it. */
export interface MachineInfo {
  name: string;
  /** `process.platform` of the machine; null when unknown. */
  platform: string | null;
  user: string | null;
  home: string | null;
}

export function machineNameError(name: string): string | null {
  return MACHINE_NAME.test(name)
    ? null
    : "Machine names use letters, digits, '.', '_' or '-' and start with a letter or digit";
}

/** A valid machine name from a hostname: its first label, with other characters replaced. */
export function machineNameFromHostname(host: string): string {
  const label = host.split(".")[0] ?? "";
  const name = label
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 63);
  return name || "machine";
}

/** This machine's stored name, or null when it has none yet (or an unreadable one, which is then replaced). */
export async function readMachineName(home = homedir()): Promise<string | null> {
  const path = machineFile(home);
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8")) as { name?: unknown };
    if (typeof parsed.name === "string" && MACHINE_NAME.test(parsed.name)) return parsed.name;
    console.warn(`[machine] ${path} has no valid name`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[machine] Cannot read ${path}:`, error);
  }
  return null;
}

export async function saveMachineName(name: string, home = homedir()): Promise<void> {
  const error = machineNameError(name);
  if (error) throw new Error(error);
  const path = machineFile(home);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ name }, null, 2)}\n`, "utf-8");
  await rename(temp, path);
}

/** This machine's name, saved from its hostname the first time so later hostname changes do not rename it. */
export async function loadOrCreateMachineName(home = homedir(), host = hostname()): Promise<string> {
  const stored = await readMachineName(home);
  if (stored) return stored;
  const name = machineNameFromHostname(host);
  await saveMachineName(name, home);
  return name;
}

/** This machine's name as the running server knows it; a rename is saved for later starts. */
export class ThisMachine {
  private constructor(
    public name: string,
    private readonly home: string,
  ) {}

  static async load(home = homedir()): Promise<ThisMachine> {
    return new ThisMachine(await loadOrCreateMachineName(home), home);
  }

  /** For tests: a name that is not read from disk. */
  static named(name: string, home: string): ThisMachine {
    return new ThisMachine(name, home);
  }

  async rename(name: string): Promise<void> {
    await saveMachineName(name, this.home);
    this.name = name;
  }
}

/** Platform, user and home of the machine this process runs on. */
export function thisMachineDetails(): Omit<MachineInfo, "name"> {
  return { platform: process.platform, user: currentUser(), home: homedir() };
}

function currentUser(): string | null {
  try {
    return userInfo().username;
  } catch {
    return process.env.USER ?? null;
  }
}

function machineFile(home: string): string {
  return join(home, ".companion", "machine.json");
}
