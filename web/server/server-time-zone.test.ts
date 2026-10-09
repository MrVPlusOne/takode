import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { canonicalTimeZone } from "./server-time-zone.js";

const moduleUrl = (path: string) => JSON.stringify(fileURLToPath(new URL(path, import.meta.url)));

/**
 * Applies `zone` in a fresh runtime started with `launchTz` (unset when undefined)
 * and reports what the server would format and pass on. A child process keeps
 * the zone change away from the other tests sharing this worker.
 */
async function applyInFreshProcess(zone: string, launchTz?: string) {
  const script = `
    import { applyServerTimeZone, serverDefaultTimeZone, timeZoneInEffect } from ${moduleUrl("./server-time-zone.ts")};
    import { buildAdapterUserMessageSourcePrefix } from ${moduleUrl("./bridge/adapter-browser-routing-source-prefix.ts")};
    import { inheritedLaunchEnv } from ${moduleUrl("./cli-launcher-env.ts")};
    import { execFileSync } from "node:child_process";
    applyServerTimeZone(${JSON.stringify(zone)});
    const ts = Date.UTC(2025, 9, 9, 8, 53);
    const launchedTz = execFileSync(process.execPath, ["-e", "process.stdout.write(process.env.TZ ?? '')"], {
      env: inheritedLaunchEnv(process.env),
    }).toString();
    console.log(JSON.stringify({
      inEffect: timeZoneInEffect(),
      defaultZone: serverDefaultTimeZone(),
      hours: new Date(ts).getHours(),
      sourceTag: buildAdapterUserMessageSourcePrefix({ id: "s" }, ts, () => undefined),
      launchedTz,
    }));
  `;
  const env = { ...process.env };
  delete env.TZ;
  if (launchTz) env.TZ = launchTz;
  const { stdout } = await promisify(execFile)(process.execPath, ["--no-install", "-e", script], {
    env,
    timeout: 10_000,
  });
  return JSON.parse(stdout.trim()) as {
    inEffect: string;
    defaultZone: string;
    hours: number;
    sourceTag: string;
    launchedTz: string;
  };
}

describe("canonicalTimeZone", () => {
  it("returns the canonical IANA name for valid zones, whatever their case or padding", () => {
    expect(canonicalTimeZone("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(canonicalTimeZone(" america/los_angeles ")).toBe("America/Los_Angeles");
    expect(canonicalTimeZone("utc")).toBe("UTC");
  });

  it("returns null for names that are not time zones", () => {
    expect(canonicalTimeZone("")).toBeNull();
    expect(canonicalTimeZone("   ")).toBeNull();
    expect(canonicalTimeZone("Pacific Standard Time")).toBeNull();
    expect(canonicalTimeZone("Mars/Olympus_Mons")).toBeNull();
  });
});

describe("applyServerTimeZone", () => {
  it("makes local times, chat source tags and launched processes use the configured zone", async () => {
    // Started without TZ, like a coordinator on a UTC machine. 08:53 UTC is 17:53 in Tokyo.
    // Bun hides a TZ assigned at runtime from env spreads, so launched processes are checked too.
    const result = await applyInFreshProcess("Asia/Tokyo");
    expect(result.inEffect).toBe("Asia/Tokyo");
    expect(result.hours).toBe(17);
    expect(result.sourceTag).toMatch(/^\[User .*\b(05|17):53\b/);
    expect(result.launchedTz).toBe("Asia/Tokyo");
  });

  it("overrides a TZ from the launch environment and reports that zone as the default", async () => {
    const result = await applyInFreshProcess("Asia/Tokyo", "Pacific/Honolulu");
    expect(result.inEffect).toBe("Asia/Tokyo");
    expect(result.defaultZone).toBe("Pacific/Honolulu");
    expect(result.launchedTz).toBe("Asia/Tokyo");
  });

  it("keeps the launch zone when the setting is empty", async () => {
    // 08:53 UTC is 22:53 the previous day in Honolulu.
    const result = await applyInFreshProcess("", "Pacific/Honolulu");
    expect(result.inEffect).toBe("Pacific/Honolulu");
    expect(result.defaultZone).toBe("Pacific/Honolulu");
    expect(result.hours).toBe(22);
  });
});
