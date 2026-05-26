import { describe, expect, it, vi } from "vitest";
import { getLocalPathOpenCapability, openLocalPathContainingFolder, _testHelpers } from "./local-path-actions.js";

describe("local path actions", () => {
  it("builds platform-specific folder open commands", () => {
    expect(
      _testHelpers.buildOpenCommand({ absolutePath: "/tmp/demo/file.txt", isDirectory: false, platform: "darwin" }),
    ).toEqual({ command: "open", args: ["-R", "/tmp/demo/file.txt"], openedPath: "/tmp/demo" });
    expect(
      _testHelpers.buildOpenCommand({ absolutePath: "C:\\demo\\file.txt", isDirectory: false, platform: "win32" }),
    ).toEqual({ command: "explorer.exe", args: ["/select,C:\\demo\\file.txt"], openedPath: "C:\\demo" });
    expect(
      _testHelpers.buildOpenCommand({ absolutePath: "/tmp/demo/file.txt", isDirectory: false, platform: "linux" }),
    ).toEqual({ command: "xdg-open", args: ["/tmp/demo"], openedPath: "/tmp/demo" });
  });

  it("reports common platform labels", () => {
    expect(getLocalPathOpenCapability("darwin")).toMatchObject({
      canOpenContainingFolder: true,
      openContainingFolderLabel: "Open in Finder",
    });
    expect(getLocalPathOpenCapability("win32")).toMatchObject({
      canOpenContainingFolder: true,
      openContainingFolderLabel: "Open in Explorer",
    });
    expect(getLocalPathOpenCapability("linux")).toMatchObject({
      canOpenContainingFolder: true,
      openContainingFolderLabel: "Open folder",
    });
  });

  it("invokes the resolved command through execFile", async () => {
    const execFile = vi.fn((_cmd, _args, callback) => callback(null, { stdout: "", stderr: "" }));

    await expect(
      openLocalPathContainingFolder({
        absolutePath: "/tmp/demo",
        isDirectory: true,
        platform: "linux",
        execFile: execFile as never,
      }),
    ).resolves.toMatchObject({ ok: true, openedPath: "/tmp/demo", platform: "linux" });

    expect(execFile).toHaveBeenCalledWith("xdg-open", ["/tmp/demo"], expect.any(Function));
  });
});
