// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api.js";
import { editorOpenFor } from "./editor-open.js";

vi.mock("../api.js", () => ({ api: { openVsCodeRemoteFile: vi.fn() } }));

/**
 * Editor links open on the user's own computer, so whether Open in VS Code works depends on the
 * machine holding the file: that computer itself, another machine reached over Remote-SSH, or one
 * not set up yet, for which the button is grayed out with the reason.
 */
describe("editorOpenFor", () => {
  const settings = { claudeBinary: "", codexBinary: "" };
  afterEach(() => vi.restoreAllMocks());

  it("opens files on the user's own computer with a local editor link", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const result = editorOpenFor("vscode-local", { name: "laptop", settings: { ...settings, editorAccess: "local" } });
    expect(result).toMatchObject({ kind: "available", label: "Open in VS Code" });
    if (result.kind === "available") await result.open({ absolutePath: "/Users/me/a.ts", line: 3 });
    expect(open).toHaveBeenCalledWith("vscode://file//Users/me/a.ts:3:1", "_blank", "noopener,noreferrer");
  });

  it("opens files on another machine over Remote-SSH by its SSH host name", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const machine = { name: "devbox", settings: { ...settings, editorAccess: "ssh" as const, sshHost: "devbox" } };
    const result = editorOpenFor("cursor", machine);
    expect(result).toMatchObject({ kind: "available", label: "Open in Cursor" });
    if (result.kind === "available") await result.open({ absolutePath: "/home/coder/r", targetKind: "directory" });
    expect(open).toHaveBeenCalledWith(
      "cursor://vscode-remote/ssh-remote+devbox/home/coder/r",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("explains how to set up a machine that isn't, and offers nothing without an editor", () => {
    const result = editorOpenFor("vscode-local", { name: "condor", settings: { ...settings, editorAccess: "ssh" } });
    expect(result.kind).toBe("unavailable");
    if (result.kind === "unavailable") expect(result.reason).toContain("Settings > Hosts");
    expect(editorOpenFor("vscode-local", null).kind).toBe("unavailable");
    expect(editorOpenFor("none", { name: "laptop", settings: { ...settings, editorAccess: "local" } }).kind).toBe(
      "none",
    );
  });

  it("leaves the Takode VS Code extension to open files itself", async () => {
    vi.mocked(api.openVsCodeRemoteFile).mockResolvedValue({ ok: true } as never);
    const result = editorOpenFor("vscode-remote", { name: "devbox", settings });
    expect(result.kind).toBe("available");
    if (result.kind === "available") await result.open({ absolutePath: "/repo/a.ts", line: 1 });
    expect(api.openVsCodeRemoteFile).toHaveBeenCalledWith({ absolutePath: "/repo/a.ts", line: 1 });
  });
});
