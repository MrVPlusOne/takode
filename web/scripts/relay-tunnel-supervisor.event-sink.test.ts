import { lstat, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createFixture,
  expectEventMetadataLine,
  pathExists,
  readStatus,
  snapshotEventLedger,
  startSupervisor,
  waitForExit,
  registerSupervisorCleanup,
} from "./relay-tunnel-supervisor.test-helpers.js";

vi.setConfig({ testTimeout: 30_000 });
registerSupervisorCleanup();

describe("relay tunnel supervisor tracked artifacts", () => {
  it("publishes a discoverable owner-only event sink alongside status and unified best effort", async () => {
    const fixture = await createFixture("exit:255");
    const supervisor = startSupervisor(fixture, { maxChildExits: 1, unifiedLogger: true });
    expect((await waitForExit(supervisor)).code).toBe(0);

    const eventPath = join(fixture.state, "events.log");
    const eventText = await readFile(eventPath, "utf8");
    const testLogText = await readFile(fixture.log, "utf8");
    const unifiedText = await readFile(join(fixture.fakeState, "unified-events"), "utf8");
    const status = await readStatus(fixture);
    expect((await stat(eventPath)).mode & 0o777).toBe(0o600);
    expect((await stat(fixture.state)).mode & 0o777).toBe(0o700);
    expect(eventText).toContain("event=wrapper_started");
    expect(eventText).toContain("event=child_started");
    expect(eventText).toContain("event=health_sample");
    expect(eventText).toContain("event=unexpected_child_exit");
    expect(testLogText).toContain("event=wrapper_started");
    expect(unifiedText).toContain("event=wrapper_started");
    expect(status.state).toBe("paused_test_complete");
    for (const line of eventText.trim().split("\n")) expectEventMetadataLine(line);
  });

  // Four supervised child cycles of shell validation take ~20s on an idle machine
  // and several times that when concurrent suites saturate the CPU.
  it("rotates the canonical event sink within fixed size and retention bounds", async () => {
    const fixture = await createFixture("exit:255");
    const supervisor = startSupervisor(fixture, {
      backoffs: "0.01,0.01,0.01,0.01,0.01",
      maxChildExits: 4,
      quickStartLimit: 99,
      eventMaxBytes: 512,
    });
    expect((await waitForExit(supervisor, 100_000)).code).toBe(0);

    const eventFiles = (await readdir(fixture.state)).filter((name) => name.startsWith("events.log")).sort();
    expect(eventFiles).toEqual(["events.log", "events.log.1", "events.log.2", "events.log.3"]);
    for (const name of eventFiles) {
      const path = join(fixture.state, name);
      const info = await stat(path);
      expect(info.mode & 0o777).toBe(0o600);
      expect(info.size).toBeLessThanOrEqual(900);
      const text = await readFile(path, "utf8");
      for (const line of text.trim().split("\n").filter(Boolean)) expectEventMetadataLine(line);
    }
  }, 120_000);

  it("accepts an existing canonical current ledger plus exactly three bounded rotations", async () => {
    const fixture = await createFixture("exit:255");
    for (const name of ["events.log", "events.log.1", "events.log.2", "events.log.3"]) {
      await writeFile(join(fixture.state, name), `canonical=${name}\n`, { mode: 0o600 });
    }
    const rotatedBefore = await snapshotEventLedger(fixture, ["events.log.1", "events.log.2", "events.log.3"]);

    const supervisor = startSupervisor(fixture, { maxChildExits: 1 });
    expect((await waitForExit(supervisor)).code).toBe(0);
    expect((await readStatus(fixture)).state).toBe("paused_test_complete");
    expect(Number(await readFile(join(fixture.fakeState, "child-attempts"), "utf8"))).toBe(1);
    expect(await snapshotEventLedger(fixture, ["events.log.1", "events.log.2", "events.log.3"])).toEqual(rotatedBefore);
    expect(await readFile(join(fixture.state, "events.log"), "utf8")).toContain("event=wrapper_started");
  });

  it.each([
    "leading-zero",
    "out-of-range",
    "oversized-current",
    "oversized-rotated",
  ])("rejects noncanonical or oversized restart ledger state: %s", async (variant) => {
    const fixture = await createFixture();
    if (variant === "leading-zero") {
      await writeFile(join(fixture.state, "events.log.01"), "sentinel-leading-zero\n", { mode: 0o600 });
    } else if (variant === "out-of-range") {
      await writeFile(join(fixture.state, "events.log.4"), "sentinel-out-of-range\n", { mode: 0o600 });
    } else if (variant === "oversized-current") {
      await writeFile(join(fixture.state, "events.log"), "x".repeat(262145), { mode: 0o600 });
    } else {
      await writeFile(join(fixture.state, "events.log.2"), "x".repeat(262145), { mode: 0o600 });
    }
    const before = await snapshotEventLedger(fixture);

    const supervisor = startSupervisor(fixture, { maxChildExits: 1, unifiedLogger: true });
    expect((await waitForExit(supervisor)).code).toBe(0);
    const status = await readStatus(fixture);
    expect(status.state).toBe("paused_fatal");
    expect(status.exitClass).toBe("event_sink_untrusted");
    expect(await pathExists(join(fixture.fakeState, "child-attempts"))).toBe(false);
    expect(await snapshotEventLedger(fixture)).toEqual(before);
    expect((await readdir(fixture.state)).filter((name) => /^events[.]log(?:[.].+)?$/.test(name)).sort()).toEqual(
      Object.keys(before).sort(),
    );
  });

  it("fails closed without following an untrusted event-sink symlink", async () => {
    const fixture = await createFixture();
    const outside = join(fixture.root, "outside-event-target");
    const eventPath = join(fixture.state, "events.log");
    await writeFile(outside, "sentinel\n", { mode: 0o600 });
    await symlink(outside, eventPath);

    const supervisor = startSupervisor(fixture, { maxChildExits: 1, unifiedLogger: true });
    expect((await waitForExit(supervisor)).code).toBe(0);
    const status = await readStatus(fixture);
    expect(status.state).toBe("paused_fatal");
    expect(status.exitClass).toBe("event_sink_untrusted");
    expect(await pathExists(join(fixture.fakeState, "child-attempts"))).toBe(false);
    expect((await lstat(eventPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(outside, "utf8")).toBe("sentinel\n");
    expect(await readFile(fixture.log, "utf8")).toContain("event=event_sink_untrusted");
    expect(await readFile(join(fixture.fakeState, "unified-events"), "utf8")).toContain("event=event_sink_untrusted");
  });
});
