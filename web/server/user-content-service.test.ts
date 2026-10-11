import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserContentInstallResult } from "./user-content-install.js";

// The service decides what crosses the host link and when; the machine side is
// covered in user-content-install.test.ts.
const mocks = vi.hoisted(() => ({ onMachine: vi.fn() }));
vi.mock("./remote-host/host-operations.js", () => ({ onMachine: mocks.onMachine }));

import { UserContentService } from "./user-content-service.js";

const done = (status: UserContentInstallResult["status"]): UserContentInstallResult => ({
  status,
  instructionFiles: [],
  skills: { linked: [], removed: [], shadowedByTakode: [], conflicts: [], takenOver: [] },
  notes: [],
});

let root: string;
let store: string;
let service: UserContentService;

beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(join(tmpdir(), "user-content-service-test-"));
  store = join(root, "store");
  service = new UserContentService({ root: store, takodeSkills: async () => ["quest"] });
});

afterEach(async () => {
  service.stop();
  await rm(root, { recursive: true, force: true });
});

async function seed(text = "Rules") {
  await mkdir(join(store, "instructions"), { recursive: true });
  await writeFile(join(store, "instructions", "all.md"), text);
}

describe("UserContentService", () => {
  it("touches no machine while the store does not exist", async () => {
    expect(await service.syncMachine("host-1", "test")).toBeNull();
    expect(mocks.onMachine).not.toHaveBeenCalled();
  });

  it("sends this machine the content directly", async () => {
    await seed();
    mocks.onMachine.mockResolvedValue(done("installed"));
    await service.syncMachine(null, "test");
    const [hostId, operation, request] = mocks.onMachine.mock.calls[0];
    expect([hostId, operation, request.content.instructions.claude, request.takodeSkills]).toEqual([
      null,
      "installUserContent",
      "Rules",
      ["quest"],
    ]);
  });

  it("sends a remote host only the hash, and the content once it reports a stale copy", async () => {
    await seed();
    mocks.onMachine.mockResolvedValueOnce(done("current"));
    await service.syncMachine("host-1", "test");
    expect(mocks.onMachine).toHaveBeenCalledTimes(1);
    expect(mocks.onMachine.mock.calls[0][2].content).toBeNull();

    mocks.onMachine.mockResolvedValueOnce(done("needs-files")).mockResolvedValueOnce(done("installed"));
    await service.syncMachine("host-1", "test");
    expect(mocks.onMachine.mock.calls[2][2].content.instructions.codex).toBe("Rules");
  });

  it("records a failure in the machine's status instead of throwing, so a launch goes ahead", async () => {
    // A host on an older build does not know the operation yet.
    await seed();
    mocks.onMachine.mockRejectedValue(new Error("Unknown host operation: installUserContent"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await service.syncMachine("host-1", "test")).toBeNull();
    expect((await service.status()).machines[0]).toMatchObject({ hostId: "host-1", error: expect.any(String) });
    warn.mockRestore();
  });

  it("passes the user's take-over approval to that machine only", async () => {
    await seed();
    mocks.onMachine.mockResolvedValue(done("installed"));
    await service.takeOver("host-1");
    expect(mocks.onMachine.mock.calls.every((call) => call[2].takeOver === true)).toBe(true);
  });

  it("delivers to this machine and every connected host when the store changes", async () => {
    await seed();
    mocks.onMachine.mockResolvedValue(done("installed"));
    const links = { status: (id: string) => ({ online: id === "up" }), onStatusChange: () => () => {} };
    service.start({ links: links as never, listHostIds: async () => ["up", "down"] });
    await vi.waitFor(() => expect(mocks.onMachine).toHaveBeenCalledTimes(2));
    expect(mocks.onMachine.mock.calls.map((call) => call[0]).sort()).toEqual([null, "up"].sort());

    mocks.onMachine.mockClear();
    await service.checkForChanges();
    expect(mocks.onMachine).not.toHaveBeenCalled(); // unchanged store, nothing sent

    await seed("Edited rules");
    await service.checkForChanges();
    expect(mocks.onMachine).toHaveBeenCalledTimes(2);
  });

  it("imports into an empty store only, then takes over the source machine", async () => {
    mocks.onMachine.mockImplementation(async (_hostId, operation) =>
      operation === "collectUserContent"
        ? { instructions: { claude: "Imported", codex: "Imported" }, skills: [], skipped: [] }
        : done("installed"),
    );

    const imported = await service.importFrom("laptop");

    expect(imported.instructionFiles).toEqual(["all.md"]);
    const install = mocks.onMachine.mock.calls.find((call) => call[1] === "installUserContent" && call[0] === "laptop");
    expect(install?.[2].takeOver).toBe(true);
    await expect(service.importFrom("laptop")).rejects.toThrow(/already has content/);
  });
});
