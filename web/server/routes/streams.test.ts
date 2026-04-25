import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("stream routes", () => {
  let home: string;

  beforeEach(() => {
    vi.resetModules();
    home = mkdtempSync(join(tmpdir(), "stream-routes-"));
    vi.stubEnv("HOME", home);
    vi.doMock("../settings-manager.js", () => ({
      getServerId: () => "server-test",
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("../settings-manager.js");
    rmSync(home, { recursive: true, force: true });
  });

  async function makeApp() {
    const { createStreamRoutes } = await import("./streams.js");
    const app = new Hono();
    app.route("/", createStreamRoutes({} as never));
    return app;
  }

  it("lists streams by Takode session group scope with current-state rollups", async () => {
    // Verifies the UI route reads the q-682 stream model by session-group scope,
    // including risk counters derived from typed timeline/state fields.
    const treeGroups = await import("../tree-group-store.js");
    const streamStore = await import("../stream-store.js");
    treeGroups._resetForTest(join(home, "tree-groups.json"));
    const group = await treeGroups.createGroup("ML Ops");
    const scope = streamStore.streamScopeForSessionGroup(group.id, "server-test");
    const stream = await streamStore.createStream({
      title: "Judge lane monitor",
      scope,
      summary: "Four lanes active",
      owners: [{ ref: "989", role: "leader", steeringMode: "leader-steered" }],
      links: [{ type: "quest", ref: "q-679" }],
    });
    await streamStore.updateStream({
      streamRef: stream.slug,
      scope,
      type: "alert",
      text: "Outputs flat in one lane",
      statePatch: { blockedOn: "runner health check" },
    });

    const app = await makeApp();
    const res = await app.request("/streams/groups");

    expect(res.status).toBe(200);
    const json = await res.json();
    const mlOps = json.groups.find((item: { group: { id: string } }) => item.group.id === group.id);
    expect(mlOps.scope).toBe(scope);
    expect(mlOps.counts).toMatchObject({ total: 1, active: 1, risk: 1, alerts: 1 });
    expect(mlOps.streams[0]).toMatchObject({
      title: "Judge lane monitor",
      current: { summary: "Four lanes active", blockedOn: "runner health check" },
    });
  });

  it("returns a stream detail dashboard with child streams", async () => {
    // Verifies detail inspection exposes child streams for dashboard/debugging views.
    const treeGroups = await import("../tree-group-store.js");
    const streamStore = await import("../stream-store.js");
    treeGroups._resetForTest(join(home, "tree-groups.json"));
    const group = await treeGroups.createGroup("Design");
    const scope = streamStore.streamScopeForSessionGroup(group.id, "server-test");
    const parent = await streamStore.createStream({ title: "Streams UI", scope, summary: "Parent stream" });
    const child = await streamStore.createStream({
      title: "Route surface",
      scope,
      parent: parent.slug,
      summary: "Child stream",
    });

    const app = await makeApp();
    const res = await app.request(`/streams/${encodeURIComponent(parent.slug)}?scope=${encodeURIComponent(scope)}`);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.stream.id).toBe(parent.id);
    expect(json.children.map((stream: { id: string }) => stream.id)).toEqual([child.id]);
  });

  it("filters group listings by query and can include archived streams", async () => {
    // Verifies the route forwards postmortem/search controls to the stream store,
    // including archived stream visibility only when explicitly requested.
    const treeGroups = await import("../tree-group-store.js");
    const streamStore = await import("../stream-store.js");
    treeGroups._resetForTest(join(home, "tree-groups.json"));
    const group = await treeGroups.createGroup("Debug");
    const scope = streamStore.streamScopeForSessionGroup(group.id, "server-test");
    await streamStore.createStream({ title: "Active stream", scope, summary: "Runner is healthy" });
    const archived = await streamStore.createStream({
      title: "Postmortem stream",
      scope,
      summary: "Archived postmortem",
    });
    await streamStore.archiveStream(archived.slug, scope, "covered by route test");

    const app = await makeApp();
    const defaultRes = await app.request("/streams/groups?q=postmortem");
    const defaultJson = await defaultRes.json();
    const defaultGroup = defaultJson.groups.find((item: { group: { id: string } }) => item.group.id === group.id);
    expect(defaultGroup.streams).toEqual([]);
    expect(defaultGroup.counts).toMatchObject({ total: 0, archived: 0 });

    const archivedRes = await app.request("/streams/groups?includeArchived=1&q=postmortem");
    const archivedJson = await archivedRes.json();
    const archivedGroup = archivedJson.groups.find((item: { group: { id: string } }) => item.group.id === group.id);
    expect(archivedJson).toMatchObject({ includeArchived: true, query: "postmortem" });
    expect(archivedGroup.streams.map((stream: { title: string }) => stream.title)).toEqual(["Postmortem stream"]);
    expect(archivedGroup.counts).toMatchObject({ total: 1, archived: 1 });
  });
});
