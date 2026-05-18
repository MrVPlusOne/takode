import { parseFileReadCommand } from "./terminal-command-preview.js";

describe("parseFileReadCommand", () => {
  it("recognizes a clear sed range read", () => {
    expect(parseFileReadCommand("sed -n '1,160p' /Users/jiayiwei/Code/HQ/.claude/skills/check/SKILL.md")).toEqual({
      commandName: "sed",
      filePath: "/Users/jiayiwei/Code/HQ/.claude/skills/check/SKILL.md",
    });
  });

  it("recognizes sed with env assignments, combined flags, and a quoted path", () => {
    expect(parseFileReadCommand('LC_ALL=C sed -En "1,80p" "src/components/Tool Block.tsx"')).toEqual({
      commandName: "sed",
      filePath: "src/components/Tool Block.tsx",
    });
  });

  it("recognizes clear single-file cat reads with display-only flags", () => {
    expect(parseFileReadCommand("cat -n -- web/src/components/ToolBlock.tsx")).toEqual({
      commandName: "cat",
      filePath: "web/src/components/ToolBlock.tsx",
    });
  });

  it("keeps pipelines and redirected stdin on the generic preview path", () => {
    expect(parseFileReadCommand("cat web/src/components/ToolBlock.tsx | head")).toBeNull();
    expect(parseFileReadCommand("sed -n '1,10p' < web/src/components/ToolBlock.tsx")).toBeNull();
  });

  it("keeps stdin, multiple files, and shell-expanded paths on the generic preview path", () => {
    expect(parseFileReadCommand("cat -")).toBeNull();
    expect(parseFileReadCommand("cat one.txt two.txt")).toBeNull();
    expect(parseFileReadCommand("cat $HOME/.zshrc")).toBeNull();
    expect(parseFileReadCommand("cat ~")).toBeNull();
    expect(parseFileReadCommand("cat ~/secret.txt")).toBeNull();
    expect(parseFileReadCommand("cat ~agent/secret.txt")).toBeNull();
    expect(parseFileReadCommand("sed -n 1,2p ~/secret.txt")).toBeNull();
    expect(parseFileReadCommand("sed -n 1,2p ~agent/secret.txt")).toBeNull();
  });

  it("keeps ambiguous sed forms on the generic preview path", () => {
    expect(parseFileReadCommand("sed 's/foo/bar/' src/file.ts")).toBeNull();
    expect(parseFileReadCommand("sed -n '1,20p' src/a.ts src/b.ts")).toBeNull();
    expect(parseFileReadCommand("sed -i 's/foo/bar/' src/file.ts")).toBeNull();
  });
});
