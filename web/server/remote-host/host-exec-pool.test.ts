import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostAgent } from "./host-agent.js";
import { HostExec, type HostExecDeps } from "./host-exec.js";
import { HostLinkManager } from "./host-link-manager.js";
import { FakeHostLink } from "../test-fixtures/fake-host-link.js";
import { ResourceLeaseManager } from "../resource-lease-manager.js";
import { ResourceLeaseStore } from "../resource-lease-store.js";

const HOST_ID = "host-1";

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 8_000): Promise<void> {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * `takode exec --pool` end to end inside one process: a real HostAgent runs
 * the commands over an in-memory host link (machine `condor`), a real lease
 * manager keeps the pools in a temporary folder, and HostExec holds one slot
 * per running command. A second machine, `condor2`, is registered but offline.
 */
describe("HostExec with lease pools", () => {
  let links: HostLinkManager;
  let fakeLinks: FakeHostLink[];
  let agent: HostAgent | null;
  let dir: string;
  let leases: ResourceLeaseManager;
  const injected: string[] = [];

  beforeEach(async () => {
    links = new HostLinkManager();
    fakeLinks = [];
    dir = await mkdtemp(join(tmpdir(), "host-exec-pool-"));
    injected.length = 0;
    leases = new ResourceLeaseManager(
      { injectUserMessage: (_id, text) => (injected.push(text), "sent"), invalidateSessionNavigation: () => {} },
      new ResourceLeaseStore("test", join(dir, "leases")),
    );
    agent = new HostAgent({
      coordinatorUrl: "http://coordinator.test",
      token: "token",
      apiProxyPort: 45_678,
      reconnectDelayMs: 20,
      log: () => {},
      connect: () => {
        const link = new FakeHostLink(links, HOST_ID);
        fakeLinks.push(link);
        return link.agentSide;
      },
    });
    agent.start();
    await waitFor(() => links.status(HOST_ID).online);
  });

  afterEach(async () => {
    agent?.stop();
    agent = null;
    leases.destroy();
    await rm(dir, { recursive: true, force: true });
  });

  function createExec(overrides: Partial<HostExecDeps> = {}): HostExec {
    const machines: Record<string, { id: string; name: string }> = {
      condor: { id: HOST_ID, name: "condor" },
      condor2: { id: "host-2", name: "condor2" },
    };
    return new HostExec({
      links,
      resolveHost: async (name) => machines[name] ?? null,
      machineNames: async () => Object.keys(machines),
      execDisabled: () => false,
      notify: () => {},
      leases,
      dir: join(dir, "exec"),
      ...overrides,
    });
  }

  const run = (exec: HostExec, command: string, pool: string, host = "") =>
    exec.start({ sessionId: "worker", sessionNum: 7, questId: null, host, command, pool });

  async function finished(exec: HostExec, id: string) {
    await waitFor(async () => !["running", "queued"].includes((await exec.wait(id, 200))!.status));
    return exec.get(id)!;
  }

  // The point of pools: one session's concurrent commands (a worker's
  // sub-agents) share the pool's capacity, the extra one waits quietly and
  // starts when a slot frees, and every slot is freed when its command ends.
  it("runs a session's commands up to the pool's capacity and queues the rest quietly", async () => {
    await leases.configure("checks@condor", 2);
    const exec = createExec();
    const marker = join(dir, "go");
    const slow = `while [ ! -e ${marker} ]; do sleep 0.05; done; echo done`;
    const first = await run(exec, slow, "checks", "condor");
    const second = await run(exec, slow, "checks", "condor");
    // A command holding a slot is told which one, as with takode lease run.
    const third = await run(
      exec,
      'echo "third: slot $TAKODE_LEASE_SLOT of $TAKODE_LEASE_RESOURCE"',
      "checks",
      "condor",
    );
    expect(first).toMatchObject({ status: "running", pool: "checks", slot: { resourceKey: "checks@condor", slot: 1 } });
    expect(second).toMatchObject({ status: "running", slot: { slot: 2 } });
    expect(third).toMatchObject({ status: "queued", host: "condor", slot: null });
    expect(exec.backgroundTasks("worker")?.tasks.map((task) => task.description)).toContain(
      'takode exec waiting for a slot of checks: echo "third: slot $TAKODE_LEASE_SLOT of $TAKODE_LEASE_RESOURCE"',
    );
    // Its caller's periodic wait notes say where it stands; only a waiting command has one.
    expect(exec.slotWait(third.id, (id) => `#${id}`)).toMatch(
      /^checks@condor: place 1 in line, 2\/2 slots held by #worker x2, none changed hands for /,
    );
    expect(exec.slotWait(first.id, (id) => `#${id}`)).toBeNull();

    await writeFile(marker, "");
    expect(await finished(exec, first.id)).toMatchObject({ status: "exited", exitCode: 0 });
    const done = await finished(exec, third.id);
    expect(done).toMatchObject({ status: "exited", exitCode: 0, slot: { resourceKey: "checks@condor" } });
    expect(done.runningAt).toBeGreaterThanOrEqual(done.startedAt);
    // Whichever of the first two ended first freed the slot it took.
    expect((await exec.readOutput(third.id))?.output).toBe(`third: slot ${done.slot?.slot} of checks@condor\n`);
    await finished(exec, second.id);
    await waitFor(async () => (await leases.getStatus("checks@condor")).leases.length === 0);
    expect(injected).toEqual([]);
  });

  // Without --host the pool picks the machine: only machines where it has a
  // configured capacity, and only those that can take a command now.
  it("runs on a machine where the pool is configured and refuses a pool none has", async () => {
    await leases.configure("checks@condor", 1);
    await leases.configure("checks@condor2", 4); // offline, so left out
    const exec = createExec();
    const job = await finished(exec, (await run(exec, "echo here", "checks")).id);
    expect(job).toMatchObject({ status: "exited", host: "condor", slot: { resourceKey: "checks@condor" } });
    await expect(run(exec, "echo", "nothing")).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining("takode lease configure nothing@<machine>"),
    });
    // A pool naming its machine pins it, like --host.
    expect(await finished(exec, (await run(exec, "echo pinned", "checks@condor")).id)).toMatchObject({
      host: "condor",
      status: "exited",
    });
  });

  // A command stopped, or abandoned by its caller, before it got a slot leaves
  // the line, so it never runs and never takes a slot meant for others.
  it("takes a stopped or abandoned waiting command out of line", async () => {
    await leases.configure("checks@condor", 1);
    let now = Date.now();
    const exec = createExec({ now: () => now, callerGoneMs: 1_000, callerCheckMs: 20 });
    const marker = join(dir, "go");
    const holder = await run(exec, `while [ ! -e ${marker} ]; do sleep 0.05; done`, "checks", "condor");
    const killed = await run(exec, "echo never", "checks", "condor");
    const abandoned = await run(exec, "echo never", "checks", "condor");
    expect(exec.kill(killed.id)).toMatchObject({
      status: "failed",
      error: "stopped while it waited for a slot of checks",
    });
    now += 2_000;
    await waitFor(() => exec.get(abandoned.id)!.status === "failed");
    expect(exec.get(abandoned.id)).toMatchObject({ callerGone: true });
    await waitFor(async () => (await leases.getStatus("checks@condor")).waiters.length === 0);
    await writeFile(marker, "");
    await finished(exec, holder.id);
    expect((await exec.readOutput(killed.id))?.output).toBe("");
  });

  // A coordinator restart keeps a waiting command in line, and it starts once
  // a slot frees; the restarted coordinator takes the running one over.
  it("keeps a waiting command in line across a coordinator restart", async () => {
    await leases.configure("checks@condor", 1);
    const marker = join(dir, "go");
    const before = createExec();
    const holder = await run(before, `while [ ! -e ${marker} ]; do sleep 0.05; done`, "checks", "condor");
    const waiting = await run(before, "echo after restart", "checks", "condor");
    expect(waiting.status).toBe("queued");

    // A new coordinator: new link manager and lease manager over the same stores.
    links = new HostLinkManager();
    leases.destroy();
    leases = new ResourceLeaseManager(
      { injectUserMessage: (_id, text) => (injected.push(text), "sent"), invalidateSessionNavigation: () => {} },
      new ResourceLeaseStore("test", join(dir, "leases")),
    );
    const after = createExec();
    await after.restore();
    fakeLinks.at(-1)!.drop();
    expect(after.get(waiting.id)).toMatchObject({ status: "queued" });
    await writeFile(marker, "");
    expect(await finished(after, holder.id)).toMatchObject({ status: "exited", exitCode: 0 });
    expect(await finished(after, waiting.id)).toMatchObject({ status: "exited", exitCode: 0 });
    expect((await after.readOutput(waiting.id))?.output).toBe("after restart\n");
    expect(injected).toEqual([]);
  });
});
