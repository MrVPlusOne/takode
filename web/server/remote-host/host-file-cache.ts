import { createHash } from "node:crypto";
import { access, mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { machineFor } from "./session-machine.js";

/** Largest remote file copied for local processing such as image previews. */
const MAX_CACHED_FILE_BYTES = 50 * 1024 * 1024;

/**
 * A local copy of a file on a remote host, for code that needs a real local
 * path (image variants). Copies are keyed by host, path and size+mtime, so a
 * changed file is fetched again.
 */
export async function localCopyOfHostFile(hostId: string, path: string, knownSize?: number): Promise<string> {
  const machine = machineFor(hostId);
  const info = await machine.stat(path);
  if (!info?.isFile) throw new Error(`File not found on host: ${path}`);
  const size = knownSize ?? info.size;
  if (size > MAX_CACHED_FILE_BYTES) throw new Error(`File is too large to preview from a remote host: ${path}`);
  const key = createHash("sha256").update(`${hostId}\0${path}\0${info.size}\0${info.mtimeMs}`).digest("hex");
  const dir = join(homedir(), ".companion", "remote-host-cache", hostId);
  const target = join(dir, `${key}${extname(path).toLowerCase()}`);
  try {
    await access(target);
    return target;
  } catch {
    // Not cached yet.
  }
  await mkdir(dir, { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, await machine.readFile(path));
  await rename(temp, target);
  return target;
}
