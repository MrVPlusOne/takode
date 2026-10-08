import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadOrCreateMachineName,
  machineNameFromHostname,
  readMachineName,
  saveMachineName,
} from "./machine-identity.js";

describe("machine identity", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "machine-identity-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  // The default name comes from the hostname's first label, made valid.
  it("derives a valid name from the hostname", () => {
    expect(machineNameFromHostname("Build-Box.local")).toBe("Build-Box");
    expect(machineNameFromHostname("dev box.example.com")).toBe("dev-box");
    expect(machineNameFromHostname("--x")).toBe("x");
    expect(machineNameFromHostname("")).toBe("machine");
  });

  // The first start saves the hostname-based name, so a later hostname change
  // does not rename the machine; a saved or renamed name is what later starts read.
  it("saves the hostname-based name once and keeps it", async () => {
    expect(await readMachineName(home)).toBeNull();
    expect(await loadOrCreateMachineName(home, "first-host.local")).toBe("first-host");
    expect(await loadOrCreateMachineName(home, "second-host.local")).toBe("first-host");

    await saveMachineName("renamed", home);
    expect(await loadOrCreateMachineName(home, "second-host.local")).toBe("renamed");
    expect(JSON.parse(await readFile(join(home, ".companion", "machine.json"), "utf-8"))).toEqual({ name: "renamed" });
    await expect(saveMachineName("bad name", home)).rejects.toThrow("Machine names use letters");
  });

  // An unreadable file does not stop startup; the machine gets a fresh name.
  it("treats an unreadable machine file as having no name", async () => {
    await mkdir(join(home, ".companion"), { recursive: true });
    await writeFile(join(home, ".companion", "machine.json"), "{not json", "utf-8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await readMachineName(home)).toBeNull();
    expect(await loadOrCreateMachineName(home, "fallback-host")).toBe("fallback-host");
    expect(warn).toHaveBeenCalled();
  });
});
