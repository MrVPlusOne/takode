import { dlopen, FFIType, ptr } from "bun:ffi";

/** `RUSAGE_INFO_V0` of `<libproc.h>`: a 16-byte UUID, then ten 64-bit counters. */
const RUSAGE_INFO_V0 = 0;
const RUSAGE_INFO_V0_WORDS = 12;
/** `ri_phys_footprint`, after the UUID and `ri_user_time` through `ri_resident_size`. */
const PHYS_FOOTPRINT_WORD = 9;

type LibProc = ReturnType<typeof openLibProc>;
let libproc: LibProc | null = null;

/**
 * A macOS process's physical footprint in bytes, the memory Activity Monitor
 * shows for it. Measure memory on macOS with this rather than `ps`'s resident
 * size: macOS compresses memory before it swaps, and compressed pages leave
 * the resident size while they still count here, so a runaway that fills
 * memory with easily compressed data (a filled buffer) can grow by gigabytes
 * while `ps` barely moves. Null off macOS and for a process it cannot read:
 * one that ended or belongs to another user.
 */
export function readPhysFootprint(pid: number): number | null {
  if (process.platform !== "darwin") return null;
  libproc ??= openLibProc();
  const info = new BigUint64Array(RUSAGE_INFO_V0_WORDS);
  if (libproc.symbols.proc_pid_rusage(pid, RUSAGE_INFO_V0, ptr(info)) !== 0) return null;
  return Number(info[PHYS_FOOTPRINT_WORD]);
}

function openLibProc() {
  return dlopen("/usr/lib/libproc.dylib", {
    proc_pid_rusage: { args: [FFIType.i32, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
  });
}
